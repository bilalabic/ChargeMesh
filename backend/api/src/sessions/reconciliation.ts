import { computeSettlement } from "@chargemesh/shared";
import type { Hex } from "viem";
import type { ChainGateway, OnchainReservation } from "../chain";
import type { Store } from "../db/store";
import type { ReservationDocument } from "../db/types";
import type { SessionEventBus } from "./events";
import type { ChargingSessionService } from "./service";

export interface ReconciliationLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

const noopLogger: ReconciliationLogger = { info: () => undefined, warn: () => undefined };

export class ReconciliationWorker {
  private timer: NodeJS.Timeout | null = null;
  private activeRun: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    private readonly chain: ChainGateway,
    private readonly sessions: ChargingSessionService,
    private readonly events: SessionEventBus,
    private readonly intervalMs: number,
    private readonly logger: ReconciliationLogger = noopLogger,
  ) {}

  async runOnce(): Promise<void> {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.execute();
    try {
      await this.activeRun;
    } finally {
      this.activeRun = null;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async execute(): Promise<void> {
    const now = new Date();
    const reservations = await this.store.listReservationsForReconciliation(now);
    for (const reservation of reservations) {
      try {
        await this.reconcile(reservation);
      } catch (err) {
        const retryAt = new Date(Date.now() + this.intervalMs);
        await this.store.updateReservation(reservation._id, {
          status: "FAILED",
          failureReason: err instanceof Error ? err.message : String(err),
          retryCount: reservation.retryCount + 1,
          nextRetryAt: retryAt,
          updatedAt: new Date(),
        });
        this.logger.warn({ err, reservationId: reservation._id, retryAt }, "Reservation reconciliation failed");
      }
    }
    if (reservations.length > 0) {
      this.logger.info({ count: reservations.length }, "Reservation reconciliation pass completed");
    }
  }

  private async reconcile(reservation: ReservationDocument): Promise<void> {
    const onchain = await this.chain.readReservation(reservation.onchainId as Hex);
    if (!onchain) return;
    if (onchain.status === "Settled") {
      await this.applySettled(reservation, onchain);
      return;
    }
    if (onchain.status === "Cancelled" || onchain.status === "Expired") {
      await this.store.syncReservationState(
        reservation._id,
        {
          status: onchain.status === "Cancelled" ? "CANCELLED" : "EXPIRED",
          failureReason: null,
          nextRetryAt: null,
        },
        true,
        new Date(),
      );
      return;
    }
    const session = await this.store.findSessionByReservation(reservation._id);
    if (onchain.status === "Active") {
      if (session?.sessionHash && reservation.status === "FAILED") {
        await this.sessions.retrySettlement(reservation);
        return;
      }
      if (reservation.status === "CONFIRMED" || reservation.status === "ACTIVE" || (reservation.status === "FAILED" && !session?.sessionHash)) {
        await this.store.syncReservationState(
          reservation._id,
          { status: "ACTIVE", failureReason: null, nextRetryAt: null },
          false,
          new Date(),
        );
      }
      if (session && session.status === "FAILED" && !session.sessionHash && session.ocppTransactionId !== null) {
        await this.sessions.resumeRemoteStart(session);
      }
      return;
    }
    if (
      onchain.status === "Reserved" &&
      reservation.status === "FAILED" &&
      session?.startTxHash &&
      !session.sessionHash
    ) {
      const startTxHash = await this.chain.startSession(reservation.onchainId as Hex);
      const at = new Date();
      await this.store.updateReservation(reservation._id, {
        status: "ACTIVE",
        startTxHash,
        failureReason: null,
        nextRetryAt: null,
        updatedAt: at,
      });
      const recovered = await this.store.updateSession(session._id, {
        status: "CHARGING",
        startTxHash,
        updatedAt: at,
      });
      if (recovered) this.events.publish(recovered._id, "session.updated", this.sessions.toView(recovered));
    }
  }

  private async applySettled(reservation: ReservationDocument, onchain: OnchainReservation): Promise<void> {
    const settlement = computeSettlement({
      requestedWh: reservation.requestedWh,
      deliveredWh: onchain.deliveredWh,
      pricePerKwhWei: reservation.pricePerKwhWei,
      depositWei: reservation.depositWei,
    });
    const at = new Date();
    await this.store.syncReservationState(
      reservation._id,
      {
        status: "SETTLED",
        settledDeliveredWh: onchain.deliveredWh,
        billableWh: settlement.billableWh,
        hostAmountWei: settlement.hostAmountWei.toString(),
        refundWei: settlement.refundWei.toString(),
        sessionHash: onchain.sessionHash,
        failureReason: null,
        nextRetryAt: null,
      },
      false,
      at,
    );
    const session = await this.store.findSessionByReservation(reservation._id);
    if (session) {
      const recovered = await this.store.updateSession(session._id, {
        status: "SETTLED",
        sessionHash: onchain.sessionHash,
        updatedAt: at,
      });
      if (recovered) this.events.publish(recovered._id, "session.updated", this.sessions.toView(recovered));
    }
  }
}
