import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildQuoteTypedData,
  canonicalize,
  computeSettlement,
  computeSessionHash,
  CreateIntentRequest,
  depositFor,
  formatMon,
  haversineKm,
  ProofOfChargeSummary,
  ProofResponse,
  Reservation,
  MatchesResponse,
  rankMatches,
  toOcppIdTag,
  toOnchainReservationId,
} from "./index";
import { createDemoFixtures, DEMO_IDS } from "./fixtures";

const PRICE = "10000000000000000"; // 0.01 MON/kWh

describe("units (must mirror ChargeMeshEscrow)", () => {
  it("computes the demo deposit", () => {
    expect(depositFor(20000, PRICE)).toBe(200000000000000000n);
    expect(formatMon(depositFor(20000, PRICE))).toBe("0.2 MON");
  });

  it("rounds the deposit up", () => {
    expect(depositFor(1, 1n)).toBe(1n);
    expect(depositFor(1000, 1n)).toBe(1n);
    expect(depositFor(1001, 1n)).toBe(2n);
  });

  it("settles a partial delivery (docs/06 backup scenario)", () => {
    const r = computeSettlement({
      requestedWh: 20000,
      deliveredWh: 14500,
      pricePerKwhWei: PRICE,
      depositWei: depositFor(20000, PRICE),
    });
    expect(r.billableWh).toBe(14500);
    expect(formatMon(r.hostAmountWei)).toBe("0.145 MON");
    expect(formatMon(r.refundWei)).toBe("0.055 MON");
  });

  it("caps over-delivery at the requested energy", () => {
    const deposit = depositFor(20000, PRICE);
    const r = computeSettlement({ requestedWh: 20000, deliveredWh: 20493, pricePerKwhWei: PRICE, depositWei: deposit });
    expect(r.billableWh).toBe(20000);
    expect(r.hostAmountWei + r.refundWei).toBe(deposit);
    expect(r.refundWei).toBe(0n);
  });
});

describe("ids", () => {
  it("builds a 20-char OCPP idTag", () => {
    const tag = toOcppIdTag(DEMO_IDS.reservation);
    expect(tag).toHaveLength(20);
    expect(tag).toBe("CM3E9C60419D844C6D80");
  });

  it("derives a stable bytes32 reservation id", () => {
    expect(toOnchainReservationId(DEMO_IDS.reservation)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(toOnchainReservationId("a")).not.toBe(toOnchainReservationId("b"));
  });
});

describe("canonical JSON", () => {
  it("sorts keys recursively and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: true, y: null }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":null,"z":true}]},"b":1}',
    );
  });

  it("rejects floats and undefined", () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow();
    expect(() => canonicalize({ a: undefined })).toThrow();
  });

  it("hash is independent of key order", () => {
    const f = createDemoFixtures(new Date("2026-10-03T07:00:00.000Z"));
    const shuffled = Object.fromEntries(Object.entries(f.proof.summary).reverse()) as ProofOfChargeSummary;
    expect(computeSessionHash(shuffled)).toBe(f.proof.sessionHash);
  });
});

describe("matching", () => {
  it("measures distance with haversine", () => {
    expect(haversineKm(40.9869, 29.0267, 40.9875, 29.03)).toBeCloseTo(0.29, 1);
  });

  it("ranks the demo slot first with the documented numbers", () => {
    const f = createDemoFixtures(new Date("2026-10-03T07:00:00.000Z"));
    const top = f.matches.matches[0]!;
    expect(top.rank).toBe(1);
    expect(top.fullyCovers).toBe(true);
    expect(top.deliverableWh).toBe(29600); // 7.4 kW * 4 h
    expect(top.quotedWh).toBe(20000);
    expect(top.depositWei).toBe("200000000000000000");
    expect(top.distanceKm).toBe(0.3);
    expect(top.node).not.toHaveProperty("lat");
  });

  it("filters out incompatible connectors", () => {
    const f = createDemoFixtures();
    const result = rankMatches({ ...f.intent, connectorType: "TYPE1" }, [{ slot: f.slot, node: f.node }]);
    expect(result).toHaveLength(0);
  });
});

describe("fixtures conform to API schemas", () => {
  const f = createDemoFixtures();
  it("parses", () => {
    expect(() => MatchesResponse.parse(f.matches)).not.toThrow();
    expect(() => Reservation.parse(f.reservation)).not.toThrow();
    expect(() => ProofResponse.parse(f.proof)).not.toThrow();
  });

  it("applies request defaults", () => {
    const parsed = CreateIntentRequest.parse({
      lat: 40.98,
      lng: 29.03,
      arriveAt: "2026-10-03T07:00:00.000Z",
      departAt: "2026-10-03T11:00:00.000Z",
      requestedWh: 20000,
      connectorType: "TYPE2",
    });
    expect(parsed.radiusKm).toBe(3);
    expect(parsed.acceptedAccessTypes).toHaveLength(3);
  });
});

describe("EIP-712 quote", () => {
  it("round-trips a settler signature", async () => {
    const f = createDemoFixtures();
    const settler = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    const typedData = buildQuoteTypedData(f.quote, 31337, "0x000000000000000000000000000000000000c0de");
    const signature = await settler.signTypedData(typedData);
    expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(settler.address);
  });
});
