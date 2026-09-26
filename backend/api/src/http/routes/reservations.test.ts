import {
  ApiError,
  CreateReservationResponse,
  DemoSeedResponse,
  Reservation,
  type ChargeIntent,
} from "@chargemesh/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app";
import { createMockChainGateway, type MockChainGateway } from "../../chain";
import { loadConfig } from "../../config";
import { MemoryStore } from "../../db/memory";

const HOST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const DRIVER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const OTHER_DRIVER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const TX = `0x${"12".repeat(32)}`;
const API = "/api/v1";
const headers = (wallet: string) => ({ "x-wallet-address": wallet });

describe("reservation lifecycle routes", () => {
  let app: FastifyInstance;
  let chain: MockChainGateway;
  let store: MemoryStore;
  let seed: DemoSeedResponse;

  beforeEach(async () => {
    const config = loadConfig({ NODE_ENV: "test", CHAIN_MODE: "mock", QUOTE_TTL_SECONDS: "300" });
    chain = createMockChainGateway({ chainId: config.chainId });
    store = new MemoryStore();
    app = await buildApp({ config, chain, store });
    await app.ready();
    const response = await app.inject({ method: "POST", url: `${API}/demo/seed`, headers: headers(HOST) });
    seed = DemoSeedResponse.parse(response.json());
  });

  afterEach(async () => app.close());

  async function createIntent(wallet: string): Promise<ChargeIntent> {
    const response = await app.inject({
      method: "POST",
      url: `${API}/intents`,
      headers: headers(wallet),
      payload: {
        lat: 40.9875,
        lng: 29.03,
        radiusKm: 3,
        arriveAt: new Date(Date.now() + 60_000).toISOString(),
        departAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        requestedWh: 20_000,
        connectorType: "TYPE2",
        acceptedAccessTypes: ["GATED_PARKING"],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as ChargeIntent;
  }

  async function reserve(wallet = DRIVER): Promise<CreateReservationResponse> {
    const intent = await createIntent(wallet);
    const response = await app.inject({
      method: "POST",
      url: `${API}/reservations`,
      headers: headers(wallet),
      payload: { intentId: intent.id, slotId: seed.slot.id },
    });
    expect(response.statusCode).toBe(201);
    return CreateReservationResponse.parse(response.json());
  }

  it("creates a signed quote and confirms it idempotently", async () => {
    const created = await reserve();
    expect(created.quote.reservationId).toBe(created.reservation.onchainId);
    expect(created.quote.slotRef).toBe(seed.slot.slotRef);
    expect(created.quote.requestedWh).toBe(created.reservation.requestedWh);
    expect(created.quote.requestedWh).toBeGreaterThan(0);
    expect(created.quote.requestedWh).toBeLessThanOrEqual(20_000);
    expect(created.signature).toMatch(/^0x[0-9a-f]+$/i);

    const first = await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/confirm`,
      headers: headers(DRIVER),
      payload: { txHash: TX },
    });
    const second = await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/confirm`,
      headers: headers(DRIVER),
      payload: { txHash: TX },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(Reservation.parse(second.json()).status).toBe("CONFIRMED");
  });

  it("reveals access only to the confirmed reservation driver", async () => {
    const created = await reserve();
    await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/confirm`,
      headers: headers(DRIVER),
      payload: { txHash: TX },
    });
    const driverView = await app.inject({
      method: "GET",
      url: `${API}/reservations/${created.reservation.id}`,
      headers: headers(DRIVER),
    });
    const hostView = await app.inject({
      method: "GET",
      url: `${API}/nodes/${seed.node.id}/reservations`,
      headers: headers(HOST),
    });
    expect(Reservation.parse(driverView.json()).access?.addressLine).toBe(seed.node.addressLine);
    expect(Reservation.array().parse(hostView.json())[0]?.access).toBeNull();
  });

  it("allows only one concurrent reservation to claim a slot", async () => {
    const [firstIntent, secondIntent] = await Promise.all([createIntent(DRIVER), createIntent(OTHER_DRIVER)]);
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `${API}/reservations`,
        headers: headers(DRIVER),
        payload: { intentId: firstIntent.id, slotId: seed.slot.id },
      }),
      app.inject({
        method: "POST",
        url: `${API}/reservations`,
        headers: headers(OTHER_DRIVER),
        payload: { intentId: secondIntent.id, slotId: seed.slot.id },
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const rejected = responses.find((response) => response.statusCode === 409);
    expect(ApiError.parse(rejected?.json()).error.code).toBe("SLOT_UNAVAILABLE");
  });

  it("syncs an on-chain cancellation and reopens the slot", async () => {
    const created = await reserve();
    await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/confirm`,
      headers: headers(DRIVER),
      payload: { txHash: TX },
    });
    const onchain = await chain.readReservation(created.reservation.onchainId as `0x${string}`);
    if (!onchain) throw new Error("mock reservation was not created");
    vi.spyOn(chain, "readReservation").mockResolvedValue({ ...onchain, status: "Cancelled" });

    const response = await app.inject({
      method: "POST",
      url: `${API}/reservations/${created.reservation.id}/sync`,
      headers: headers(DRIVER),
      payload: { txHash: TX },
    });
    expect(response.statusCode).toBe(200);
    expect(Reservation.parse(response.json()).status).toBe("CANCELLED");
    expect((await store.findSlot(seed.slot.id))?.status).toBe("OPEN");
  });
});
