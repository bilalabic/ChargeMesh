import {
  ApiError,
  ChargingNode,
  DemoSeedResponse,
  EnergySlot,
  MatchesResponse,
  PublicChargingNode,
} from "@chargemesh/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createMockChainGateway } from "../../chain";
import { loadConfig } from "../../config";
import { MemoryStore } from "../../db/memory";

const HOST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DRIVER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const OTHER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const API = "/api/v1";

const headers = (wallet: string) => ({ "x-wallet-address": wallet });

describe("node, slot, seed and matching routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const config = loadConfig({ NODE_ENV: "test", CHAIN_MODE: "mock" });
    app = await buildApp({
      config,
      chain: createMockChainGateway({ chainId: config.chainId }),
      store: new MemoryStore(),
    });
    await app.ready();
  });

  afterEach(async () => app.close());

  it("creates a node and hides private fields from other wallets", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${API}/nodes`,
      headers: headers(HOST),
      payload: {
        name: "Moda Ofis Otoparkı",
        areaLabel: "Kadıköy, İstanbul",
        addressLine: "Caferağa Mah. Moda Cad. No:1",
        lat: 40.9869,
        lng: 29.0267,
        connectorType: "TYPE2",
        maxPowerKw: 7.4,
        accessType: "GATED_PARKING",
        accessInstructions: "B2 katı",
        ocppChargePointId: "CM-TEST-001",
        ocppConnectorId: 1,
      },
    });
    expect(created.statusCode).toBe(201);
    const own = ChargingNode.parse(created.json());
    expect(own.addressLine).toContain("Caferağa");

    const publicResponse = await app.inject({
      method: "GET",
      url: `${API}/nodes/${own.id}`,
      headers: headers(OTHER),
    });
    expect(publicResponse.statusCode).toBe(200);
    const publicNode = PublicChargingNode.parse(publicResponse.json());
    expect(publicNode.id).toBe(own.id);
    expect(publicResponse.json()).not.toHaveProperty("addressLine");
    expect(publicResponse.json()).not.toHaveProperty("lat");
  });

  it("rejects overlapping slots and ranks the valid slot", async () => {
    const seedResponse = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(HOST) });
    const seed = DemoSeedResponse.parse(seedResponse.json());
    const duplicate = await app.inject({
      method: "POST",
      url: `${API}/nodes/${seed.node.id}/slots`,
      headers: headers(HOST),
      payload: {
        startsAt: new Date(Date.now() + 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        maxEnergyWh: 5_000,
        pricePerKwhWei: "10000000000000000",
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(ApiError.parse(duplicate.json()).error.code).toBe("INVALID_STATE");

    const intentResponse = await app.inject({
      method: "POST",
      url: `${API}/intents`,
      headers: headers(DRIVER),
      payload: {
        lat: 40.9875,
        lng: 29.03,
        radiusKm: 3,
        arriveAt: new Date(Date.now() + 60_000).toISOString(),
        departAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
        requestedWh: 20_000,
        connectorType: "TYPE2",
        acceptedAccessTypes: ["GATED_PARKING"],
      },
    });
    expect(intentResponse.statusCode).toBe(201);
    const intentId = intentResponse.json().id as string;
    const matchesResponse = await app.inject({
      method: "GET",
      url: `${API}/intents/${intentId}/matches`,
      headers: headers(DRIVER),
    });
    expect(matchesResponse.statusCode).toBe(200);
    const matches = MatchesResponse.parse(matchesResponse.json());
    expect(matches.matches).toHaveLength(1);
    expect(matches.matches[0]?.slotId).toBe(seed.slot.id);
    expect(matches.matches[0]?.depositWei).toBe("200000000000000000");
  });

  it("keeps demo seed idempotent and permits only the owning host", async () => {
    const first = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(HOST) });
    const second = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(HOST) });
    const a = DemoSeedResponse.parse(first.json());
    const b = DemoSeedResponse.parse(second.json());
    expect(b.node.id).toBe(a.node.id);
    expect(b.slot.id).toBe(a.slot.id);
    EnergySlot.parse(b.slot);

    const forbidden = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(OTHER) });
    expect(forbidden.statusCode).toBe(409);
    expect(ApiError.parse(forbidden.json()).error.code).toBe("INVALID_STATE");
  });
});
