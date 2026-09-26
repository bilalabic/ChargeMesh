import {
  ChargingSession,
  CreateReservationResponse,
  DemoSeedResponse,
  ProofResponse,
  type ChargeIntent,
} from "@chargemesh/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { SubmittedTransactionError, createMockChainGateway, type MockChainGateway } from "../chain";
import { loadConfig, type AppConfigEnv } from "../config";
import { MemoryStore } from "../db/memory";
import { ChargerRegistry } from "../ocpp/server";
import { SessionEventBus, type SessionEvent } from "./events";
import { ReconciliationWorker } from "./reconciliation";
import { ChargingSessionService, type OcppCommands } from "./service";

const HOST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DRIVER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const TX = `0x${"34".repeat(32)}`;
const API = "/api/v1";
const headers = (wallet: string) => ({ "x-wallet-address": wallet });

describe("charging session lifecycle", () => {
  let app: FastifyInstance;
  let config: AppConfigEnv;
  let store: MemoryStore;
  let chain: MockChainGateway;
  let service: ChargingSessionService;
  let events: SessionEventBus;
  let commands: OcppCommands;
  let seed: DemoSeedResponse;

  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: "test", CHAIN_MODE: "mock" });
    store = new MemoryStore();
    chain = createMockChainGateway({ chainId: config.chainId });
    events = new SessionEventBus();
    commands = {
      isConnected: () => true,
      remoteStart: vi.fn(async () => "Accepted" as const),
      remoteStop: vi.fn(async () => "Accepted" as const),
    };
    service = new ChargingSessionService(store, chain, events, config);
    service.setCommands(commands);
    app = await buildApp({ config, chain, events, sessions: service, store, chargers: new ChargerRegistry() });
    await app.ready();
    const response = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(HOST) });
    seed = DemoSeedResponse.parse(response.json());
  });

  afterEach(async () => app.close());

  async function confirmedReservation(): Promise<CreateReservationResponse> {
    const intentResponse = await app.inject({
      method: "POST",
      url: `${API}/intents`,
      headers: headers(DRIVER),
      payload: {
        lat: 40.9875,
        lng: 29.03,
        arriveAt: new Date(Date.now() + 60_000).toISOString(),
        departAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
        requestedWh: 20_000,
        connectorType: "TYPE2",
        acceptedAccessTypes: ["GATED_PARKING"],
      },
    });
    const intent = intentResponse.json() as ChargeIntent;
    const createResponse = await app.inject({
      method: "POST",
      url: `${API}/reservations`,
      headers: headers(DRIVER),
      payload: { intentId: intent.id, slotId: seed.slot.id },
    });
    const created = CreateReservationResponse.parse(createResponse.json());
    const confirmResponse = await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/confirm`,
      headers: headers(DRIVER),
      payload: { txHash: TX },
    });
    expect(confirmResponse.statusCode).toBe(200);
    return created;
  }

  it("starts, meters, auto-stops, settles and exposes a verified proof", async () => {
    const reservation = await confirmedReservation();
    const startResponse = await app.inject({
      method: "POST",
      url: `${API}/sessions/start`,
      headers: headers(DRIVER),
      payload: {
        chargePointId: seed.node.ocppChargePointId,
        connectorId: seed.node.ocppConnectorId,
        reservationId: reservation.reservation.id,
      },
    });
    expect(startResponse.statusCode).toBe(201);
    const starting = ChargingSession.parse(startResponse.json());
    const document = await store.findSession(starting.id);
    if (!document) throw new Error("session was not stored");
    const published: SessionEvent[] = [];
    const unsubscribe = events.subscribe(document._id, (event) => published.push(event));

    const startInput = {
      chargePointId: document.chargePointId,
      connectorId: document.connectorId,
      idTag: document.ocppIdTag,
      meterStartWh: 1_000_000,
      timestamp: new Date(),
    };
    const startSpy = vi.spyOn(chain, "startSession");
    const [transaction, duplicateStart] = await Promise.all([
      service.onStartTransaction(startInput),
      service.onStartTransaction(startInput),
    ]);
    expect(transaction.accepted).toBe(true);
    expect(duplicateStart).toEqual(transaction);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const sampledAt = new Date();
    const meterInput = {
      chargePointId: document.chargePointId,
      transactionId: transaction.transactionId,
      sampledAt,
      energyWh: 1_000_000 + document.requestedWh,
      powerW: 7_400,
      raw: { meterValue: [] },
    };
    await service.onMeter(meterInput);
    await service.onMeter(meterInput);
    expect(await store.listMeterSamples(document._id)).toHaveLength(1);
    expect(commands.remoteStop).toHaveBeenCalledWith(document.chargePointId, transaction.transactionId);
    expect((await store.findSession(document._id))?.status).toBe("STOPPING");

    const stopInput = {
      chargePointId: document.chargePointId,
      transactionId: transaction.transactionId,
      meterStopWh: 1_000_000 + document.requestedWh,
      stoppedAt: new Date(),
      reason: "Remote",
    };
    const settleSpy = vi.spyOn(chain, "settle");
    const stopped = await Promise.all([
      service.onStopTransaction(stopInput),
      service.onStopTransaction(stopInput),
    ]);
    expect(stopped).toEqual([true, true]);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect((await store.findSession(document._id))?.status).toBe("SETTLED");
    expect(published.some((event) => event.event === "meter")).toBe(true);
    expect(published.some((event) => event.event === "settled")).toBe(true);
    unsubscribe();

    const proofResponse = await app.inject({
      method: "GET",
      url: `${API}/reservations/${reservation.reservation.id}/proof`,
      headers: headers(DRIVER),
    });
    expect(proofResponse.statusCode).toBe(200);
    const proof = ProofResponse.parse(proofResponse.json());
    expect(proof.verified).toBe(true);
    expect(proof.summary.deliveredWh).toBe(document.requestedWh);
    expect(proof.summary.meterSamples.count).toBe(1);
  });

  it("keeps a submitted settlement hash when receipt waiting fails", async () => {
    const reservation = await confirmedReservation();
    const session = await service.start(DRIVER, {
      chargePointId: seed.node.ocppChargePointId,
      connectorId: seed.node.ocppConnectorId,
      reservationId: reservation.reservation.id,
    });
    const transaction = await service.onStartTransaction({
      chargePointId: session.chargePointId,
      connectorId: session.connectorId,
      idTag: session.ocppIdTag,
      meterStartWh: 1_000_000,
      timestamp: new Date(),
    });
    expect(transaction.accepted).toBe(true);
    const submittedHash = `0x${"78".repeat(32)}` as `0x${string}`;
    const failedSettle = vi.spyOn(chain, "settle").mockRejectedValue(
      new SubmittedTransactionError("settle", submittedHash, new Error("receipt timeout")),
    );
    await service.onStopTransaction({
      chargePointId: session.chargePointId,
      transactionId: transaction.transactionId,
      meterStopWh: 1_014_500,
      stoppedAt: new Date(),
      reason: "EVDisconnected",
    });
    expect((await store.findSession(session._id))?.settleTxHash).toBe(submittedHash);
    const failedReservation = await store.findReservation(reservation.reservation.id);
    expect(failedReservation?.status).toBe("FAILED");
    expect(failedReservation?.settleTxHash).toBe(submittedHash);
    expect(failedReservation?.nextRetryAt).not.toBeNull();

    failedSettle.mockRestore();
    await store.updateReservation(reservation.reservation.id, { nextRetryAt: new Date(0), updatedAt: new Date() });
    const reconciliation = new ReconciliationWorker(store, chain, service, events, 5_000);
    await reconciliation.runOnce();
    expect((await store.findReservation(reservation.reservation.id))?.status).toBe("SETTLED");
    expect((await store.findSession(session._id))?.status).toBe("SETTLED");
  });

  it("resumes a half-finished start after the submitted transaction becomes active", async () => {
    const reservation = await confirmedReservation();
    const session = await service.start(DRIVER, {
      chargePointId: seed.node.ocppChargePointId,
      connectorId: seed.node.ocppConnectorId,
      reservationId: reservation.reservation.id,
    });
    const submittedHash = `0x${"9a".repeat(32)}` as `0x${string}`;
    const failedStart = vi.spyOn(chain, "startSession").mockRejectedValue(
      new SubmittedTransactionError("startSession", submittedHash, new Error("receipt timeout")),
    );
    const startInput = {
      chargePointId: session.chargePointId,
      connectorId: session.connectorId,
      idTag: session.ocppIdTag,
      meterStartWh: 1_000_000,
      timestamp: new Date(),
    };
    const first = await service.onStartTransaction(startInput);
    expect(first.accepted).toBe(false);
    failedStart.mockRestore();
    await chain.startSession(reservation.reservation.onchainId as `0x${string}`);
    await store.updateReservation(reservation.reservation.id, { nextRetryAt: new Date(0), updatedAt: new Date() });

    const reconciliation = new ReconciliationWorker(store, chain, service, events, 5_000);
    await reconciliation.runOnce();
    expect((await store.findSession(session._id))?.status).toBe("STARTING");
    expect((await store.findReservation(reservation.reservation.id))?.status).toBe("ACTIVE");

    const noDuplicateStart = vi.spyOn(chain, "startSession");
    const resumed = await service.onStartTransaction(startInput);
    expect(resumed).toEqual({ transactionId: first.transactionId, accepted: true });
    expect(noDuplicateStart).not.toHaveBeenCalled();
    expect((await store.findSession(session._id))?.status).toBe("CHARGING");
  });
});
