import { randomUUID } from "node:crypto";
import {
  ProofOfChargeSummary,
  canonicalize,
  computeSamplesHash,
  computeSessionHash,
  toOcppIdTag,
  type StartSessionRequest,
} from "@chargemesh/shared";
import type { Hex } from "viem";
import { isSubmittedTransactionError, type ChainGateway, type SettleResult } from "../chain";
import type { AppConfigEnv } from "../config";
import type { Store } from "../db/store";
import type { MeterSampleDocument, ReservationDocument, SessionDocument } from "../db/types";
import { ApiError } from "../http/errors";
import type { SessionEventBus } from "./events";

export interface OcppCommands {
  isConnected(chargePointId: string): boolean;
  remoteStart(chargePointId: string, params: { connectorId: number; idTag: string }): Promise<"Accepted" | "Rejected">;
  remoteStop(chargePointId: string, transactionId: number): Promise<"Accepted" | "Rejected">;
}

export interface StartTransactionInput {
  chargePointId: string;
  connectorId: number;
  idTag: string;
  meterStartWh: number;
  timestamp: Date;
}

export interface MeterInput {
  chargePointId: string;
  transactionId: number;
  sampledAt: Date;
  energyWh: number;
  powerW: number;
  raw: unknown;
}

export interface StopTransactionInput {
  chargePointId: string;
  transactionId: number;
  meterStopWh: number;
  stoppedAt: Date;
  reason: string;
}

export class ChargingSessionService {
  private commands: OcppCommands | null = null;
  private readonly operations = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly chain: ChainGateway,
    private readonly events: SessionEventBus,
    private readonly config: AppConfigEnv,
  ) {}

  setCommands(commands: OcppCommands): void {
    this.commands = commands;
  }

  private async serialize<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.operations.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.operations.get(sessionId) === current) this.operations.delete(sessionId);
    }
  }

  async start(wallet: string, input: StartSessionRequest): Promise<SessionDocument> {
    const reservation = await this.resolveReservation(wallet, input);
    const slot = await this.store.findSlot(reservation.slotId);
    const node = slot ? await this.store.findNode(slot.nodeId) : null;
    if (!node || node.ocppChargePointId !== input.chargePointId || node.ocppConnectorId !== input.connectorId) {
      throw new ApiError("INVALID_STATE", "Reservation does not match the requested connector");
    }
    if (!this.config.demoAllowAnyTime) {
      const nowMs = Date.now();
      if (nowMs < reservation.windowStartsAt.getTime() - 15 * 60_000 || nowMs > reservation.windowEndsAt.getTime()) {
        throw new ApiError("OUTSIDE_TIME_WINDOW", "Reservation is outside its charging window");
      }
    }
    if (!this.commands?.isConnected(input.chargePointId)) {
      throw new ApiError("CHARGER_OFFLINE", "Charge point is offline");
    }
    const existing = await this.store.findSessionByReservation(reservation._id);
    if (existing) return existing;

    const now = new Date();
    const session: SessionDocument = {
      _id: randomUUID(),
      reservationId: reservation._id,
      status: "STARTING",
      chargePointId: input.chargePointId,
      connectorId: input.connectorId,
      ocppIdTag: toOcppIdTag(reservation._id),
      ocppTransactionId: null,
      requestedWh: reservation.requestedWh,
      meterStartWh: null,
      latestMeterWh: null,
      meterStopWh: null,
      deliveredWh: 0,
      powerW: 0,
      startedAt: null,
      stoppedAt: null,
      stopReason: null,
      proofCanonicalJson: null,
      sessionHash: null,
      startTxHash: null,
      settleTxHash: null,
      stopRequested: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.createSession(session);
    let remoteStatus: "Accepted" | "Rejected";
    try {
      remoteStatus = await this.commands.remoteStart(input.chargePointId, {
        connectorId: input.connectorId,
        idTag: session.ocppIdTag,
      });
    } catch {
      await this.store.updateSession(session._id, {
        status: "FAILED",
        stopReason: "ChargerOffline",
        updatedAt: new Date(),
      });
      throw new ApiError("CHARGER_OFFLINE", "Charge point disconnected before the start command");
    }
    if (remoteStatus !== "Accepted") {
      await this.store.updateSession(session._id, {
        status: "FAILED",
        stopReason: "RemoteStartRejected",
        updatedAt: new Date(),
      });
      throw new ApiError("INVALID_STATE", "Charge point rejected the start command");
    }
    this.events.publish(session._id, "session.updated", this.toView(session));
    return session;
  }

  async resumeRemoteStart(session: SessionDocument): Promise<boolean> {
    if (!this.commands?.isConnected(session.chargePointId)) return false;
    const starting = await this.store.updateSession(session._id, {
      status: "STARTING",
      stopReason: null,
      updatedAt: new Date(),
    });
    if (!starting) return false;
    try {
      const status = await this.commands.remoteStart(session.chargePointId, {
        connectorId: session.connectorId,
        idTag: session.ocppIdTag,
      });
      if (status === "Accepted") return true;
    } catch {
      // Reconciliation will retry after the next controlled interval.
    }
    await this.store.updateSession(session._id, { status: "FAILED", updatedAt: new Date() });
    return false;
  }

  async onStartTransaction(input: StartTransactionInput): Promise<{ transactionId: number; accepted: boolean }> {
    const initial = await this.store.findSessionByIdTag(input.idTag);
    if (!initial) return { transactionId: 0, accepted: false };
    return this.serialize(initial._id, async () => {
      const session = await this.store.findSessionByIdTag(input.idTag);
      if (!session || session.chargePointId !== input.chargePointId || session.connectorId !== input.connectorId) {
        return { transactionId: 0, accepted: false };
      }
      if (session.ocppTransactionId !== null && ["CHARGING", "STOPPING", "COMPLETED", "SETTLING", "SETTLED"].includes(session.status)) {
        return { transactionId: session.ocppTransactionId, accepted: true };
      }
      if (session.status !== "STARTING") return { transactionId: 0, accepted: false };
      const reservation = await this.requireReservation(session.reservationId);
      const transactionId = session.ocppTransactionId ?? (await this.store.nextOcppTransactionId());
      await this.store.updateSession(session._id, {
        ocppTransactionId: transactionId,
        meterStartWh: input.meterStartWh,
        latestMeterWh: input.meterStartWh,
        startedAt: input.timestamp,
        updatedAt: new Date(),
      });
      try {
        const startTxHash =
          reservation.status === "ACTIVE" && session.startTxHash
            ? (session.startTxHash as Hex)
            : await this.chain.startSession(reservation.onchainId as Hex);
        const now = new Date();
        const updated = await this.store.updateSession(session._id, {
          status: "CHARGING",
          ocppTransactionId: transactionId,
          meterStartWh: input.meterStartWh,
          latestMeterWh: input.meterStartWh,
          startedAt: input.timestamp,
          startTxHash,
          updatedAt: now,
        });
        await this.store.updateReservation(reservation._id, {
          status: "ACTIVE",
          startTxHash,
          failureReason: null,
          updatedAt: now,
        });
        if (updated) this.events.publish(updated._id, "session.updated", this.toView(updated));
        return { transactionId, accepted: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isSubmittedTransactionError(err)) {
          await this.store.updateSession(session._id, { startTxHash: err.txHash, updatedAt: new Date() });
          await this.store.updateReservation(reservation._id, { startTxHash: err.txHash, updatedAt: new Date() });
        }
        await this.failSession(session, reservation, message);
        return { transactionId, accepted: false };
      }
    });
  }

  async onMeter(input: MeterInput): Promise<void> {
    const initial = await this.store.findSessionByTransaction(input.transactionId);
    if (!initial) return;
    await this.serialize(initial._id, async () => {
      const session = await this.store.findSessionByTransaction(input.transactionId);
      if (!session || !["CHARGING", "STOPPING"].includes(session.status) || session.chargePointId !== input.chargePointId) return;
      const meterStartWh = session.meterStartWh ?? input.energyWh;
      const deliveredWh = Math.max(0, input.energyWh - meterStartWh);
      const sample: MeterSampleDocument = {
        sessionId: session._id,
        ocppTransactionId: input.transactionId,
        sampledAt: input.sampledAt,
        energyWh: input.energyWh,
        powerW: input.powerW,
        raw: input.raw,
        receivedAt: new Date(),
      };
      if (!(await this.store.insertMeterSample(sample))) return;
      const shouldStop = deliveredWh >= session.requestedWh && !session.stopRequested;
      const updated = await this.store.updateSession(session._id, {
        status: shouldStop ? "STOPPING" : session.status,
        latestMeterWh: input.energyWh,
        deliveredWh,
        powerW: input.powerW,
        stopRequested: session.stopRequested || shouldStop,
        updatedAt: new Date(),
      });
      if (!updated) return;
      this.events.publish(updated._id, "meter", {
        sessionId: updated._id,
        timestamp: input.sampledAt.toISOString(),
        energyWh: input.energyWh,
        deliveredWh,
        powerW: input.powerW,
      });
      this.events.publish(updated._id, "session.updated", this.toView(updated));
      if (shouldStop && this.commands) {
        let status: "Accepted" | "Rejected" = "Rejected";
        try {
          status = await this.commands.remoteStop(updated.chargePointId, input.transactionId);
        } catch {
          // The meter sample remains valid; a later sample or manual stop can retry.
        }
        if (status !== "Accepted") {
          const resumed = await this.store.updateSession(updated._id, {
            status: "CHARGING",
            stopRequested: false,
            updatedAt: new Date(),
          });
          this.events.publish(updated._id, "error", {
            code: "REMOTE_STOP_REJECTED",
            message: "Charge point rejected the automatic stop command",
          });
          if (resumed) this.events.publish(resumed._id, "session.updated", this.toView(resumed));
        }
      }
    });
  }

  async requestStop(session: SessionDocument): Promise<SessionDocument> {
    return this.serialize(session._id, async () => {
      const current = await this.store.findSession(session._id);
      if (!current) throw new ApiError("NOT_FOUND", "Charging session not found");
      if (["STOPPING", "COMPLETED", "SETTLING", "SETTLED"].includes(current.status)) return current;
      if (current.status !== "CHARGING" || current.ocppTransactionId === null) {
        throw new ApiError("INVALID_STATE", `Cannot stop a ${current.status} session`);
      }
      if (!this.commands) throw new ApiError("CHARGER_OFFLINE", "OCPP server is unavailable");
      let status: "Accepted" | "Rejected";
      try {
        status = await this.commands.remoteStop(current.chargePointId, current.ocppTransactionId);
      } catch {
        throw new ApiError("CHARGER_OFFLINE", "Charge point disconnected before the stop command");
      }
      if (status !== "Accepted") throw new ApiError("INVALID_STATE", "Charge point rejected the stop command");
      const updated = await this.store.updateSession(current._id, {
        status: "STOPPING",
        stopRequested: true,
        updatedAt: new Date(),
      });
      if (!updated) throw new ApiError("NOT_FOUND", "Charging session not found");
      this.events.publish(updated._id, "session.updated", this.toView(updated));
      return updated;
    });
  }

  async onStopTransaction(input: StopTransactionInput): Promise<boolean> {
    const initial = await this.store.findSessionByTransaction(input.transactionId);
    if (!initial) return false;
    return this.serialize(initial._id, async () => {
      const session = await this.store.findSessionByTransaction(input.transactionId);
      if (!session || session.chargePointId !== input.chargePointId || session.meterStartWh === null) return false;
      if (["COMPLETED", "SETTLING", "SETTLED", "FAILED"].includes(session.status)) return true;
      const reservation = await this.requireReservation(session.reservationId);
      const deliveredWh = Math.max(0, input.meterStopWh - session.meterStartWh);
      const now = new Date();
      const completed = await this.store.updateSession(session._id, {
        status: "COMPLETED",
        latestMeterWh: input.meterStopWh,
        meterStopWh: input.meterStopWh,
        deliveredWh,
        powerW: 0,
        stoppedAt: input.stoppedAt,
        stopReason: input.reason,
        updatedAt: now,
      });
      await this.store.updateReservation(reservation._id, { status: "COMPLETED", updatedAt: now });
      if (!completed) return false;
      this.events.publish(completed._id, "session.updated", this.toView(completed));
      await this.settle(completed, reservation);
      return true;
    });
  }

  async retrySettlement(reservation: ReservationDocument): Promise<boolean> {
    const initial = await this.store.findSessionByReservation(reservation._id);
    if (!initial?.sessionHash) return false;
    return this.serialize(initial._id, async () => {
      const session = await this.store.findSession(initial._id);
      const currentReservation = await this.store.findReservation(reservation._id);
      if (!session?.sessionHash || !currentReservation) return false;
      if (session.status === "SETTLED" || currentReservation.status === "SETTLED") return true;
      try {
        const result = await this.chain.settle(
          currentReservation.onchainId as Hex,
          session.deliveredWh,
          session.sessionHash as Hex,
        );
        await this.applySettlementResult(session, currentReservation, result);
        return true;
      } catch (err) {
        if (isSubmittedTransactionError(err)) {
          await this.store.updateSession(session._id, { settleTxHash: err.txHash, updatedAt: new Date() });
          await this.store.updateReservation(currentReservation._id, {
            settleTxHash: err.txHash,
            updatedAt: new Date(),
          });
        }
        await this.failSession(
          session,
          currentReservation,
          err instanceof Error ? err.message : String(err),
        );
        return false;
      }
    });
  }

  toView(session: SessionDocument) {
    return {
      id: session._id,
      reservationId: session.reservationId,
      status: session.status,
      chargePointId: session.chargePointId,
      connectorId: session.connectorId,
      ocppTransactionId: session.ocppTransactionId,
      requestedWh: session.requestedWh,
      meterStartWh: session.meterStartWh,
      latestMeterWh: session.latestMeterWh,
      deliveredWh: session.deliveredWh,
      powerW: session.powerW,
      startedAt: session.startedAt?.toISOString() ?? null,
      stoppedAt: session.stoppedAt?.toISOString() ?? null,
      stopReason: session.stopReason,
      sessionHash: session.sessionHash,
      txs: { start: session.startTxHash, settle: session.settleTxHash },
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private async resolveReservation(wallet: string, input: StartSessionRequest): Promise<ReservationDocument> {
    if (input.reservationId) {
      const reservation = await this.store.findReservation(input.reservationId);
      if (!reservation) throw new ApiError("NOT_FOUND", "Reservation not found");
      if (reservation.driverAddress !== wallet) throw new ApiError("FORBIDDEN", "Reservation does not belong to this wallet");
      if (reservation.status !== "CONFIRMED") throw new ApiError("INVALID_STATE", "Reservation is not confirmed");
      return reservation;
    }
    const matches: ReservationDocument[] = [];
    for (const reservation of await this.store.listReservationsByWallet(wallet, "driver")) {
      if (reservation.status !== "CONFIRMED") continue;
      const slot = await this.store.findSlot(reservation.slotId);
      const node = slot ? await this.store.findNode(slot.nodeId) : null;
      if (node?.ocppChargePointId === input.chargePointId && node.ocppConnectorId === input.connectorId) {
        matches.push(reservation);
      }
    }
    if (matches.length === 0) throw new ApiError("NOT_FOUND", "No confirmed reservation matches this connector");
    if (matches.length > 1) throw new ApiError("AMBIGUOUS_RESERVATION", "More than one reservation matches this connector");
    return matches[0]!;
  }

  private async requireReservation(id: string): Promise<ReservationDocument> {
    const reservation = await this.store.findReservation(id);
    if (!reservation) throw new Error(`Session references missing reservation ${id}`);
    return reservation;
  }

  private async settle(session: SessionDocument, reservation: ReservationDocument): Promise<void> {
    const samples = await this.store.listMeterSamples(session._id);
    if (
      session.ocppTransactionId === null ||
      session.startedAt === null ||
      session.stoppedAt === null ||
      session.meterStartWh === null ||
      session.meterStopWh === null ||
      session.stopReason === null
    ) {
      await this.failSession(session, reservation, "Session is missing Proof of Charge fields");
      return;
    }
    const hashSamples = samples.map((sample) => ({
      timestamp: sample.sampledAt.toISOString(),
      energyWh: sample.energyWh,
      powerW: sample.powerW,
    }));
    const summary = ProofOfChargeSummary.parse({
      version: "chargemesh.poc.v1",
      chainId: this.chain.chainId,
      contract: this.chain.contractAddress,
      reservationId: reservation.onchainId,
      chargePointId: session.chargePointId,
      connectorId: session.connectorId,
      ocppTransactionId: session.ocppTransactionId,
      startedAt: session.startedAt.toISOString(),
      stoppedAt: session.stoppedAt.toISOString(),
      meterStartWh: session.meterStartWh,
      meterStopWh: session.meterStopWh,
      requestedWh: session.requestedWh,
      deliveredWh: session.deliveredWh,
      stopReason: session.stopReason,
      meterSamples: { count: hashSamples.length, samplesHash: computeSamplesHash(hashSamples) },
      source: "ocpp-simulator",
    });
    const proofCanonicalJson = canonicalize(summary);
    const sessionHash = computeSessionHash(summary);
    await this.store.updateSession(session._id, {
      status: "SETTLING",
      proofCanonicalJson,
      sessionHash,
      updatedAt: new Date(),
    });
    try {
      const result = await this.chain.settle(reservation.onchainId as Hex, session.deliveredWh, sessionHash);
      await this.applySettlementResult(session, reservation, result);
    } catch (err) {
      if (isSubmittedTransactionError(err)) {
        await this.store.updateSession(session._id, { settleTxHash: err.txHash, updatedAt: new Date() });
        await this.store.updateReservation(reservation._id, { settleTxHash: err.txHash, updatedAt: new Date() });
      }
      await this.failSession(session, reservation, err instanceof Error ? err.message : String(err));
    }
  }

  private async applySettlementResult(
    session: SessionDocument,
    reservation: ReservationDocument,
    result: SettleResult,
  ): Promise<void> {
    const settledAt = new Date();
    const settledSession = await this.store.updateSession(session._id, {
      status: "SETTLED",
      settleTxHash: result.txHash,
      sessionHash: result.sessionHash,
      updatedAt: settledAt,
    });
    await this.store.updateReservation(reservation._id, {
      status: "SETTLED",
      settleTxHash: result.txHash,
      settledDeliveredWh: result.deliveredWh,
      billableWh: result.billableWh,
      hostAmountWei: result.hostAmountWei.toString(),
      refundWei: result.refundWei.toString(),
      sessionHash: result.sessionHash,
      failureReason: null,
      nextRetryAt: null,
      updatedAt: settledAt,
    });
    if (settledSession) this.events.publish(settledSession._id, "session.updated", this.toView(settledSession));
    this.events.publish(session._id, "settled", {
      sessionId: session._id,
      reservationId: reservation._id,
      settlement: {
        deliveredWh: result.deliveredWh,
        billableWh: result.billableWh,
        hostAmountWei: result.hostAmountWei.toString(),
        refundWei: result.refundWei.toString(),
        sessionHash: result.sessionHash,
      },
    });
  }

  private async failSession(session: SessionDocument, reservation: ReservationDocument, message: string): Promise<void> {
    const now = new Date();
    await this.store.updateSession(session._id, { status: "FAILED", updatedAt: now });
    await this.store.updateReservation(reservation._id, {
      status: "FAILED",
      failureReason: message,
      retryCount: reservation.retryCount + 1,
      nextRetryAt: new Date(now.getTime() + 30_000),
      updatedAt: now,
    });
    this.events.publish(session._id, "error", { code: "SETTLEMENT_FAILED", message });
  }
}
