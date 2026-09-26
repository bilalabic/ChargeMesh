import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Address,
  canonicalize,
  canonicalUuid,
  computeSessionHash,
  computeSettlement,
  costFor,
  CreateIntentRequest,
  CreateSlotRequest,
  depositFor,
  MAX_PRICE_PER_KWH_WEI,
  MIN_WINDOW_MS,
  ProofOfChargeSummary,
  ProofResponse,
  rankMatches,
  ReservationQuote,
  SESSION_SSE_EVENTS,
  SessionErrorEvent,
  Settlement,
  toBig,
  toOcppIdTag,
  toOnchainReservationId,
  toSlotRef,
  UINT128_MAX_WEI,
  Uint32Wh,
  type CreateIntentRequestParsed,
  type CreateNodeRequestParsed,
  type MatchCandidate,
} from "./index";
import { createDemoFixtures, DEMO_IDS } from "./fixtures";

const NOW = new Date("2026-10-03T07:00:00.000Z");
const iso = (offsetMin: number) => new Date(NOW.getTime() + offsetMin * 60_000).toISOString();

// ---------- 1. matching ----------

describe("rankMatches hardening", () => {
  const base = () => {
    const f = createDemoFixtures(NOW);
    const candidate: MatchCandidate = { slot: f.slot, node: f.node };
    return { f, candidate };
  };
  const withSlot = (c: MatchCandidate, patch: Partial<MatchCandidate["slot"]>): MatchCandidate => ({
    ...c,
    slot: { ...c.slot, ...patch },
  });

  it("drops candidates with NaN distance / radius", () => {
    const { f, candidate } = base();
    const nanNode = { ...candidate, node: { ...candidate.node, lat: Number.NaN } };
    expect(rankMatches(f.intent, [nanNode], NOW)).toHaveLength(0);
    expect(rankMatches({ ...f.intent, radiusKm: Number.NaN }, [candidate], NOW)).toHaveLength(0);
  });

  it("drops candidates with unparseable window bounds", () => {
    const { f, candidate } = base();
    expect(rankMatches(f.intent, [withSlot(candidate, { endsAt: "not-a-date" })], NOW)).toHaveLength(0);
    expect(rankMatches({ ...f.intent, arriveAt: "garbage" }, [candidate], NOW)).toHaveLength(0);
    expect(rankMatches(f.intent, [candidate], new Date(Number.NaN))).toHaveLength(0);
  });

  it("drops candidates whose deliverable energy is NaN or zero", () => {
    const { f, candidate } = base();
    const nanPower = { ...candidate, node: { ...candidate.node, maxPowerKw: Number.NaN } };
    expect(rankMatches(f.intent, [nanPower], NOW)).toHaveLength(0);
    expect(rankMatches(f.intent, [withSlot(candidate, { maxEnergyWh: 0 })], NOW)).toHaveLength(0);
  });

  it("clamps the window start to now", () => {
    const { f, candidate } = base();
    // Intent and slot both started an hour ago; the window must start now.
    const intent = { ...f.intent, arriveAt: iso(-60), departAt: iso(120) };
    const slot = withSlot(candidate, { startsAt: iso(-90) });
    const [m] = rankMatches(intent, [slot], NOW);
    expect(m?.window.startsAt).toBe(NOW.toISOString());
    expect(m?.window.endsAt).toBe(iso(120));
    expect(m?.deliverableWh).toBe(14800); // 7.4 kW * 2 h, not 3 h
  });

  it("drops windows fully in the past or shorter than MIN_WINDOW_MS after clamping", () => {
    const { f, candidate } = base();
    const past = { ...f.intent, arriveAt: iso(-120), departAt: iso(-10) };
    expect(rankMatches(past, [candidate], NOW)).toHaveLength(0);
    const tooShort = { ...f.intent, arriveAt: iso(-60), departAt: iso(MIN_WINDOW_MS / 60_000 - 1) };
    expect(rankMatches(tooShort, [candidate], NOW)).toHaveLength(0);
    const exact = { ...f.intent, arriveAt: iso(-60), departAt: iso(MIN_WINDOW_MS / 60_000) };
    expect(rankMatches(exact, [candidate], NOW)).toHaveLength(1);
  });

  it("de-duplicates candidates by slot id (first wins)", () => {
    const { f, candidate } = base();
    const cheaper = withSlot(candidate, { pricePerKwhWei: "1" });
    const result = rankMatches(f.intent, [candidate, cheaper, candidate], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.pricePerKwhWei).toBe(candidate.slot.pricePerKwhWei);
  });

  it("is deterministic for a fixed now", () => {
    const { f, candidate } = base();
    expect(rankMatches(f.intent, [candidate], NOW)).toEqual(rankMatches(f.intent, [candidate], NOW));
  });
});

// ---------- 2. schemas ----------

describe("schemas", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const slot = (patch: Record<string, unknown> = {}) => ({
    startsAt: iso(0),
    endsAt: iso(240),
    maxEnergyWh: 40000,
    pricePerKwhWei: "10000000000000000",
    ...patch,
  });

  it("CreateSlotRequest: endsAt must be in the future", () => {
    expect(CreateSlotRequest.safeParse(slot()).success).toBe(true);
    const r = CreateSlotRequest.safeParse(slot({ startsAt: iso(-120), endsAt: iso(-60) }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.join(".") === "endsAt")).toBe(true);
  });

  it("CreateSlotRequest: price is bounded so the deposit fits uint128", () => {
    expect(MAX_PRICE_PER_KWH_WEI).toBe(((1n << 128n) - 1n) / 100n);
    expect(depositFor(100_000, MAX_PRICE_PER_KWH_WEI) <= UINT128_MAX_WEI).toBe(true);
    expect(depositFor(100_000, MAX_PRICE_PER_KWH_WEI + 1n) > UINT128_MAX_WEI).toBe(true);
    expect(CreateSlotRequest.safeParse(slot({ pricePerKwhWei: MAX_PRICE_PER_KWH_WEI.toString() })).success).toBe(true);
    expect(
      CreateSlotRequest.safeParse(slot({ pricePerKwhWei: (MAX_PRICE_PER_KWH_WEI + 1n).toString() })).success,
    ).toBe(false);
    expect(CreateSlotRequest.safeParse(slot({ pricePerKwhWei: "0" })).success).toBe(false);
  });

  const intent = (patch: Record<string, unknown> = {}) => ({
    lat: 40.98,
    lng: 29.03,
    arriveAt: iso(0),
    departAt: iso(240),
    requestedWh: 20000,
    connectorType: "TYPE2",
    ...patch,
  });

  it("CreateIntentRequest: departAt in the future, window between 15 min and 24 h", () => {
    const ok: CreateIntentRequestParsed = CreateIntentRequest.parse(intent());
    expect(ok.radiusKm).toBe(3);
    expect(CreateIntentRequest.safeParse(intent({ arriveAt: iso(-120), departAt: iso(-1) })).success).toBe(false);
    expect(CreateIntentRequest.safeParse(intent({ departAt: iso(14) })).success).toBe(false);
    expect(CreateIntentRequest.safeParse(intent({ departAt: iso(15) })).success).toBe(true);
    expect(CreateIntentRequest.safeParse(intent({ departAt: iso(24 * 60) })).success).toBe(true);
    expect(CreateIntentRequest.safeParse(intent({ departAt: iso(24 * 60 + 1) })).success).toBe(false);
  });

  it("exports parsed output types with defaults applied", () => {
    const node: CreateNodeRequestParsed = {
      name: "Node",
      areaLabel: "Area",
      addressLine: "Street 1",
      lat: 0,
      lng: 0,
      connectorType: "TYPE2",
      maxPowerKw: 7.4,
      accessType: "OPEN_PARKING",
      accessInstructions: "",
      ocppChargePointId: "CP-1",
      ocppConnectorId: 1,
    };
    expect(node.ocppConnectorId).toBe(1);
  });

  it("Uint32Wh bounds on-chain Wh fields", () => {
    expect(Uint32Wh.safeParse(0xffff_ffff).success).toBe(true);
    expect(Uint32Wh.safeParse(0x1_0000_0000).success).toBe(false);
    expect(Uint32Wh.safeParse(-1).success).toBe(false);
    const f = createDemoFixtures(NOW);
    expect(Settlement.safeParse({ ...f.reservation.settlement, deliveredWh: 2 ** 32 }).success).toBe(false);
    expect(ProofOfChargeSummary.safeParse({ ...f.proof.summary, requestedWh: 2 ** 32 }).success).toBe(false);
    expect(ProofResponse.safeParse(f.proof).success).toBe(true);
  });

  it("quote amounts are bounded to uint128", () => {
    const f = createDemoFixtures(NOW);
    expect(ReservationQuote.safeParse(f.quote).success).toBe(true);
    expect(ReservationQuote.safeParse({ ...f.quote, depositWei: UINT128_MAX_WEI.toString() }).success).toBe(true);
    expect(ReservationQuote.safeParse({ ...f.quote, depositWei: (UINT128_MAX_WEI + 1n).toString() }).success).toBe(false);
    expect(ReservationQuote.safeParse({ ...f.quote, requestedWh: 2 ** 32 }).success).toBe(false);
  });

  it("Address accepts lower/upper case and valid EIP-55, rejects a bad checksum", () => {
    expect(Address.safeParse("0x70997970c51812dc3a010c7d01b50e0d17dc79c8").success).toBe(true);
    expect(Address.safeParse("0x70997970C51812DC3A010C7D01B50E0D17DC79C8").success).toBe(true);
    expect(Address.safeParse("0x70997970C51812dc3A010C7d01b50e0d17dc79C8").success).toBe(true);
    // Same address, one letter's case flipped.
    expect(Address.safeParse("0x70997970c51812dc3A010C7d01b50e0d17dc79C8").success).toBe(false);
    expect(Address.safeParse("0x1234").success).toBe(false);
  });

  it("SSE error event is session.error with a { code, message } payload", () => {
    expect(SESSION_SSE_EVENTS.error).toBe("session.error");
    expect(SessionErrorEvent.parse({ code: "CHAIN_ERROR", message: "boom" })).toEqual({
      code: "CHAIN_ERROR",
      message: "boom",
    });
    expect(SessionErrorEvent.safeParse({ message: "boom" }).success).toBe(false);
  });
});

// ---------- 3. canonical JSON ----------

describe("canonicalize hardening", () => {
  it("sorts integer-like keys as strings (unlike JSON.stringify)", () => {
    const value = { b: 1, "10": 2, "2": 3, a: 4 };
    expect(JSON.stringify(value)).toBe('{"2":3,"10":2,"b":1,"a":4}');
    expect(canonicalize(value)).toBe('{"10":2,"2":3,"a":4,"b":1}');
  });

  it("sorts by UTF-16 code units", () => {
    // "\u{1F600}" (surrogate pair D83D..) sorts before "～" in UTF-16 but after it in code points.
    expect(canonicalize({ "～": 1, "\u{1F600}": 2, Z: 3, a: 4 })).toBe('{"Z":3,"a":4,"\u{1F600}":2,"～":1}');
  });

  it("rejects non-plain objects, sparse arrays, cycles and other unsupported values", () => {
    expect(() => canonicalize({ d: new Date(0) })).toThrow(/non-plain/);
    expect(() => canonicalize(new Map())).toThrow(/non-plain/);
    class Foo {
      a = 1;
    }
    expect(() => canonicalize(new Foo())).toThrow(/non-plain/);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalize([1, , 3])).toThrow(/sparse/);
    expect(() => canonicalize(new Array(2))).toThrow(/sparse/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(/circular/);
    expect(() => canonicalize({ a: 1n })).toThrow(/bigint/);
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: 2 ** 53 })).toThrow();
    expect(() => canonicalize({ [Symbol("s")]: 1 })).toThrow(/symbol/);
    expect(() =>
      canonicalize(Object.defineProperty({}, "x", { get: () => 1, enumerable: true })),
    ).toThrow(/accessor/);
  });

  it("allows null-prototype objects and reuse of the same object in siblings", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 1;
    o.a = 2;
    const shared = { x: 1 };
    expect(canonicalize({ o, p: shared, q: shared })).toBe('{"o":{"a":2,"b":1},"p":{"x":1},"q":{"x":1}}');
  });

  it("serializes an own __proto__ key as data", () => {
    const parsed = JSON.parse('{"b":1,"__proto__":{"x":1}}') as unknown;
    expect(canonicalize(parsed)).toBe('{"__proto__":{"x":1},"b":1}');
    const defined = Object.defineProperty({ a: 1 }, "__proto__", {
      value: 5,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(canonicalize(defined)).toBe('{"__proto__":5,"a":1}');
  });

  it("hashes strings as-is, without Unicode normalization; -0 becomes 0", () => {
    expect(canonicalize({ s: "é" })).not.toBe(canonicalize({ s: "é" }));
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
    expect(canonicalize("a\"b\n")).toBe('"a\\"b\\n"');
  });

  it("matches the pinned golden vector (cross-language reference)", () => {
    const summary: ProofOfChargeSummary = {
      version: "chargemesh.poc.v1",
      chainId: 10143,
      contract: "0x000000000000000000000000000000000000c0de",
      reservationId: "0x74239d04acba62a37de3d64fb8cd6867d661071eb861ac60fa9b141a58a46326",
      chargePointId: "CM-DEMO-001",
      connectorId: 1,
      ocppTransactionId: 42,
      startedAt: "2026-10-03T07:01:00.000Z",
      stoppedAt: "2026-10-03T07:04:00.000Z",
      meterStartWh: 1000000,
      meterStopWh: 1020000,
      requestedWh: 20000,
      deliveredWh: 20000,
      stopReason: "Remote",
      meterSamples: { count: 4, samplesHash: `0x${"ab".repeat(32)}` },
      source: "ocpp-simulator",
    };
    expect(canonicalize(summary)).toBe(
      '{"chainId":10143,"chargePointId":"CM-DEMO-001","connectorId":1,' +
        '"contract":"0x000000000000000000000000000000000000c0de","deliveredWh":20000,' +
        '"meterSamples":{"count":4,"samplesHash":"0xabababababababababababababababababababababababababababababababab"},' +
        '"meterStartWh":1000000,"meterStopWh":1020000,"ocppTransactionId":42,"requestedWh":20000,' +
        '"reservationId":"0x74239d04acba62a37de3d64fb8cd6867d661071eb861ac60fa9b141a58a46326",' +
        '"source":"ocpp-simulator","startedAt":"2026-10-03T07:01:00.000Z","stopReason":"Remote",' +
        '"stoppedAt":"2026-10-03T07:04:00.000Z","version":"chargemesh.poc.v1"}',
    );
    expect(computeSessionHash(summary)).toBe(
      "0xc965a9594ca1471b67b4438173405f28313abdd0f83979ed20832140afc23542",
    );
  });
});

// ---------- 4. units ----------

describe("strict units", () => {
  it("toBig accepts canonical non-negative integers only", () => {
    expect(toBig("0")).toBe(0n);
    expect(toBig("123")).toBe(123n);
    expect(toBig(5)).toBe(5n);
    expect(toBig(7n)).toBe(7n);
    for (const bad of ["", " 1", "01", "-1", "1.0", "1e3", "0x10", "+1", "1 "]) {
      expect(() => toBig(bad), JSON.stringify(bad)).toThrow(/decimal integer string/);
    }
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => toBig(bad), String(bad)).toThrow(/safe integer/);
    }
    expect(() => toBig(-1n)).toThrow(/non-negative/);
    expect(() => depositFor(1000, "0x10")).toThrow(/pricePerKwhWei/);
    expect(() => costFor(-1, 1n)).toThrow(/wh/);
  });

  it("computeSettlement validates uint32 energy values", () => {
    const base = { requestedWh: 20000, deliveredWh: 1000, pricePerKwhWei: "10", depositWei: "200" };
    expect(computeSettlement(base).billableWh).toBe(1000);
    expect(computeSettlement({ ...base, deliveredWh: 0 }).hostAmountWei).toBe(0n);
    expect(() => computeSettlement({ ...base, deliveredWh: -1 })).toThrow(/deliveredWh/);
    expect(() => computeSettlement({ ...base, deliveredWh: 1.5 })).toThrow(/deliveredWh/);
    expect(() => computeSettlement({ ...base, deliveredWh: 2 ** 32 })).toThrow(/deliveredWh/);
    expect(() => computeSettlement({ ...base, requestedWh: Number.NaN })).toThrow(/requestedWh/);
    expect(() => computeSettlement({ ...base, depositWei: "-5" })).toThrow(/depositWei/);
  });
});

// ---------- 5. ids ----------

describe("strict ids", () => {
  const UPPER = DEMO_IDS.reservation.toUpperCase();

  it("lower-cases the uuid before hashing", () => {
    expect(canonicalUuid(UPPER)).toBe(DEMO_IDS.reservation);
    expect(toOnchainReservationId(UPPER)).toBe(toOnchainReservationId(DEMO_IDS.reservation));
    expect(toSlotRef(DEMO_IDS.slot.toUpperCase())).toBe(toSlotRef(DEMO_IDS.slot));
    expect(toOcppIdTag(UPPER)).toBe(toOcppIdTag(DEMO_IDS.reservation));
  });

  it("rejects anything that is not a hyphenated uuid", () => {
    for (const bad of ["a", "", DEMO_IDS.reservation.replace(/-/g, ""), `${DEMO_IDS.reservation}0`, ` ${DEMO_IDS.reservation}`]) {
      expect(() => toOnchainReservationId(bad), bad).toThrow(/Invalid uuid/);
      expect(() => toSlotRef(bad), bad).toThrow(/Invalid uuid/);
      expect(() => toOcppIdTag(bad), bad).toThrow(/Invalid uuid/);
    }
  });

  it("keeps contracts/test/fixtures/quote-signature.json valid (ids unchanged)", () => {
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../contracts/test/fixtures/quote-signature.json", import.meta.url)),
        "utf8",
      ),
    ) as { quote: { reservationId: string; slotRef: string } };
    // Same uuids as scripts/gen-quote-fixture.ts.
    expect(toOnchainReservationId("00000000-0000-4000-8000-000000000001")).toBe(fixture.quote.reservationId);
    expect(toSlotRef("00000000-0000-4000-8000-000000000002")).toBe(fixture.quote.slotRef);
  });
});

// ---------- 10. fixtures ----------

describe("demo fixtures", () => {
  it("report the mock chain id 31337 and the placeholder contract", () => {
    const f = createDemoFixtures(NOW);
    expect(f.proof.summary.chainId).toBe(31337);
    expect(f.proof.summary.contract).toBe("0x000000000000000000000000000000000000c0de");
  });

  it("validate deliveredWh up front", () => {
    expect(() => createDemoFixtures(NOW, -1)).toThrow(/deliveredWh/);
    expect(() => createDemoFixtures(NOW, 1.5)).toThrow(/deliveredWh/);
    expect(() => createDemoFixtures(NOW, 2 ** 32)).toThrow(/deliveredWh/);
    expect(createDemoFixtures(NOW, 14500).reservation.settlement?.billableWh).toBe(14500);
  });
});
