import { createServer } from "node:net";
import {
  ChargingSession,
  CreateReservationResponse,
  DemoSeedResponse,
  MatchesResponse,
  ProofResponse,
  Reservation,
  type ChargeIntent,
} from "@chargemesh/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChargerSimulator } from "../../charger-sim/src/simulator";
import type { SimConfig } from "../../charger-sim/src/config";
import { buildApp } from "./app";
import { createMockChainGateway } from "./chain";
import { loadConfig } from "./config";
import { MemoryStore } from "./db/memory";
import { ChargerRegistry, OcppCentralSystem } from "./ocpp/server";
import { SessionEventBus } from "./sessions/events";
import { ChargingSessionService } from "./sessions/service";

const HOST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DRIVER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const RESERVE_TX = `0x${"56".repeat(32)}`;
const API = "/api/v1";
const headers = (wallet: string) => ({ "x-wallet-address": wallet });

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port allocated"));
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function waitFor<T>(read: () => Promise<T> | T, accept: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = await read();
  }
  if (!accept(value)) throw new Error(`Acceptance condition was not met within ${timeoutMs} ms`);
  return value;
}

describe("M1 HTTP + real OCPP simulator acceptance", () => {
  const apps: FastifyInstance[] = [];
  const centrals: OcppCentralSystem[] = [];
  const simulators: ChargerSimulator[] = [];

  afterEach(async () => {
    await Promise.all(simulators.splice(0).map((simulator) => simulator.shutdown()));
    await Promise.all(centrals.splice(0).map((central) => central.stop()));
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it.each([
    { label: "full 20 kWh", vehicleAcceptWh: null, expectedWh: 20_000, expectedReason: "Remote" },
    { label: "partial 14.5 kWh", vehicleAcceptWh: 14_500, expectedWh: 14_500, expectedReason: "EVDisconnected" },
  ])("settles $label delivery", async ({ vehicleAcceptWh, expectedWh, expectedReason }) => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const port = await availablePort();
    const config = loadConfig({ NODE_ENV: "test", CHAIN_MODE: "mock" });
    const store = new MemoryStore();
    const chain = createMockChainGateway({ chainId: config.chainId });
    const registry = new ChargerRegistry();
    const events = new SessionEventBus();
    const sessions = new ChargingSessionService(store, chain, events, config);
    const central = new OcppCentralSystem({ port, host: "127.0.0.1", registry, store, sessions });
    sessions.setCommands(central);
    centrals.push(central);
    await central.start();
    const app = await buildApp({ config, chain, chargers: registry, events, sessions, ocpp: central, store });
    apps.push(app);
    await app.ready();

    const seedResponse = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(HOST) });
    const seed = DemoSeedResponse.parse(seedResponse.json());
    const simConfig: SimConfig = {
      csUrl: `ws://127.0.0.1:${port}/ocpp`,
      chargePointId: seed.node.ocppChargePointId,
      connectorId: seed.node.ocppConnectorId,
      powerKw: 10,
      timeScale: 7_200,
      meterIntervalMs: 100,
      meterStartWh: 1_000_000,
      vehicleAcceptWh,
    };
    const simulator = new ChargerSimulator(simConfig);
    simulators.push(simulator);
    simulator.start();
    await waitFor(
      () => registry.getConnectorStatus(seed.node.ocppChargePointId, seed.node.ocppConnectorId),
      (status) => status === "Available",
    );

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
    const matchesResponse = await app.inject({
      method: "GET",
      url: `${API}/intents/${intent.id}/matches`,
      headers: headers(DRIVER),
    });
    const matches = MatchesResponse.parse(matchesResponse.json());
    expect(matches.matches[0]?.slotId).toBe(seed.slot.id);
    const reserveResponse = await app.inject({
      method: "POST",
      url: `${API}/reservations`,
      headers: headers(DRIVER),
      payload: { intentId: intent.id, slotId: seed.slot.id },
    });
    const created = CreateReservationResponse.parse(reserveResponse.json());
    const confirmResponse = await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/confirm`,
      headers: headers(DRIVER),
      payload: { txHash: RESERVE_TX },
    });
    expect(Reservation.parse(confirmResponse.json()).status).toBe("CONFIRMED");

    const startResponse = await app.inject({
      method: "POST",
      url: `${API}/sessions/start`,
      headers: headers(DRIVER),
      payload: {
        chargePointId: seed.node.ocppChargePointId,
        connectorId: seed.node.ocppConnectorId,
        reservationId: created.reservation.id,
      },
    });
    expect(startResponse.statusCode).toBe(201);
    const starting = ChargingSession.parse(startResponse.json());
    const settled = await waitFor(
      () => store.findSession(starting.id),
      (session) => session?.status === "SETTLED",
    );
    expect(settled?.deliveredWh).toBe(expectedWh);
    expect(settled?.stopReason).toBe(expectedReason);

    const proofResponse = await app.inject({
      method: "GET",
      url: `${API}/reservations/${created.reservation.id}/proof`,
      headers: headers(DRIVER),
    });
    const proof = ProofResponse.parse(proofResponse.json());
    expect(proof.verified).toBe(true);
    expect(proof.summary.deliveredWh).toBe(expectedWh);
    expect(proof.onchain?.billableWh).toBe(expectedWh);
  }, 15_000);
});
