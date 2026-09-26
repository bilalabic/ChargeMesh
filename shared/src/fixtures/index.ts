/**
 * Demo fixtures matching docs/06-demo-senaryosu.md. Owner: frontend team.
 * Built by a factory so timestamps are always relative to "now" and every derived value
 * (matches, deposit, settlement, hash) comes from the same shared functions the API uses.
 */
import type {
  ChargeIntent,
  ChargingNode,
  ChargingSession,
  EnergySlot,
  MatchesResponse,
  ProofOfChargeSummary,
  ProofResponse,
  Reservation,
  ReservationQuote,
} from "../api/schemas";
import { PROOF_VERSION } from "../api/schemas";
import { toOnchainReservationId, toSlotRef } from "../ids";
import { rankMatches } from "../matching";
import { computeSamplesHash, computeSessionHash, canonicalize } from "../proof";
import { computeSettlement } from "../units";

export const DEMO_HOST_ADDRESS = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
export const DEMO_DRIVER_ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
export const DEMO_CONTRACT_ADDRESS = "0x000000000000000000000000000000000000c0de";
export const DEMO_CHARGE_POINT_ID = "CM-DEMO-001";
export const DEMO_PRICE_PER_KWH_WEI = "10000000000000000"; // 0.01 MON / kWh
const MOCK_TX = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

export const DEMO_IDS = {
  node: "0b6f3f6e-6a51-4f3a-9d0e-1c2b3a4d5e61",
  slot: "1c7a4e2f-7b62-4a4b-8e1f-2d3c4b5e6f72",
  intent: "2d8b5f30-8c73-4b5c-9f20-3e4d5c6f7083",
  reservation: "3e9c6041-9d84-4c6d-8031-4f5e6d708194",
  session: "4fad7152-ae95-4d7e-9142-506f7e8192a5",
} as const;

export interface DemoFixtures {
  node: ChargingNode;
  slot: EnergySlot;
  intent: ChargeIntent;
  matches: MatchesResponse;
  quote: ReservationQuote;
  reservation: Reservation;
  session: ChargingSession;
  proof: ProofResponse;
}

export function createDemoFixtures(now: Date = new Date(), deliveredWh = 20000): DemoFixtures {
  if (!Number.isSafeInteger(deliveredWh) || deliveredWh < 0 || deliveredWh > 0xffff_ffff) {
    throw new RangeError(`Demo fixtures: deliveredWh must be a uint32 integer, got ${deliveredWh}`);
  }
  const t = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60_000).toISOString();
  const createdAt = t(-60);

  const node: ChargingNode = {
    id: DEMO_IDS.node,
    hostAddress: DEMO_HOST_ADDRESS,
    name: "Moda Ofis Otoparkı",
    areaLabel: "Kadıköy, İstanbul",
    connectorType: "TYPE2",
    maxPowerKw: 7.4,
    accessType: "GATED_PARKING",
    ocppChargePointId: DEMO_CHARGE_POINT_ID,
    ocppConnectorId: 1,
    online: true,
    createdAt,
    addressLine: "Caferağa Mah. Moda Cad. No:1, Kadıköy/İstanbul",
    lat: 40.9869,
    lng: 29.0267,
    accessInstructions:
      "B2 katı, 14 numaralı park yeri. Bariyerde ChargeMesh rezervasyonunu söyleyin.",
    startUrl: `http://localhost:3000/start?cp=${DEMO_CHARGE_POINT_ID}&c=1`,
  };

  const slot: EnergySlot = {
    id: DEMO_IDS.slot,
    nodeId: node.id,
    slotRef: toSlotRef(DEMO_IDS.slot),
    startsAt: t(-5),
    endsAt: t(9 * 60),
    maxEnergyWh: 40000,
    pricePerKwhWei: DEMO_PRICE_PER_KWH_WEI,
    status: "OPEN",
    createdAt,
  };

  const intent: ChargeIntent = {
    id: DEMO_IDS.intent,
    driverAddress: DEMO_DRIVER_ADDRESS,
    lat: 40.9875,
    lng: 29.03,
    radiusKm: 3,
    arriveAt: t(0),
    departAt: t(240),
    requestedWh: 20000,
    connectorType: "TYPE2",
    acceptedAccessTypes: ["OPEN_PARKING", "GATED_PARKING", "BUILDING_GARAGE"],
    createdAt: t(0),
  };

  const matches: MatchesResponse = {
    intentId: intent.id,
    generatedAt: t(0),
    matches: rankMatches(intent, [{ slot, node }], now),
  };
  const top = matches.matches[0];
  if (!top) throw new Error("Demo fixtures: expected at least one match");

  const onchainId = toOnchainReservationId(DEMO_IDS.reservation);
  const quote: ReservationQuote = {
    reservationId: onchainId,
    slotRef: slot.slotRef,
    driver: DEMO_DRIVER_ADDRESS,
    host: DEMO_HOST_ADDRESS,
    requestedWh: top.quotedWh,
    pricePerKwhWei: top.pricePerKwhWei,
    depositWei: top.depositWei,
    startTime: Math.floor(Date.parse(top.window.startsAt) / 1000),
    endTime: Math.floor(Date.parse(top.window.endsAt) / 1000),
    quoteExpiry: Math.floor(now.getTime() / 1000) + 300,
  };

  const meterStartWh = 1_000_000;
  const samples = [0.25, 0.5, 0.75, 1].map((f, i) => ({
    timestamp: t(1 + i),
    energyWh: meterStartWh + Math.round(deliveredWh * f),
    powerW: 7400,
  }));
  const summary: ProofOfChargeSummary = {
    version: PROOF_VERSION,
    // Mock mode reports the local Anvil chain id (docs/02-mimari.md); the contract is a placeholder.
    chainId: 31337,
    contract: DEMO_CONTRACT_ADDRESS,
    reservationId: onchainId,
    chargePointId: DEMO_CHARGE_POINT_ID,
    connectorId: 1,
    ocppTransactionId: 1,
    startedAt: t(1),
    stoppedAt: t(4),
    meterStartWh,
    meterStopWh: meterStartWh + deliveredWh,
    requestedWh: quote.requestedWh,
    deliveredWh,
    stopReason: deliveredWh >= quote.requestedWh ? "Remote" : "EVDisconnected",
    meterSamples: { count: samples.length, samplesHash: computeSamplesHash(samples) },
    source: "ocpp-simulator",
  };
  const sessionHash = computeSessionHash(summary);
  const s = computeSettlement({
    requestedWh: quote.requestedWh,
    deliveredWh,
    pricePerKwhWei: quote.pricePerKwhWei,
    depositWei: quote.depositWei,
  });
  const settlement = {
    deliveredWh,
    billableWh: s.billableWh,
    hostAmountWei: s.hostAmountWei.toString(),
    refundWei: s.refundWei.toString(),
    sessionHash,
  };

  const reservation: Reservation = {
    id: DEMO_IDS.reservation,
    onchainId,
    intentId: intent.id,
    slotId: slot.id,
    driverAddress: DEMO_DRIVER_ADDRESS,
    hostAddress: DEMO_HOST_ADDRESS,
    status: "SETTLED",
    requestedWh: quote.requestedWh,
    pricePerKwhWei: quote.pricePerKwhWei,
    depositWei: quote.depositWei,
    window: top.window,
    holdExpiresAt: new Date(quote.quoteExpiry * 1000).toISOString(),
    node: top.node,
    access: {
      addressLine: node.addressLine,
      lat: node.lat,
      lng: node.lng,
      accessInstructions: node.accessInstructions,
    },
    sessionId: DEMO_IDS.session,
    txs: { reserve: MOCK_TX(1), start: MOCK_TX(2), settle: MOCK_TX(3), cancel: null },
    settlement,
    createdAt: t(0),
    updatedAt: t(4),
  };

  const session: ChargingSession = {
    id: DEMO_IDS.session,
    reservationId: reservation.id,
    status: "SETTLED",
    chargePointId: DEMO_CHARGE_POINT_ID,
    connectorId: 1,
    ocppTransactionId: 1,
    requestedWh: quote.requestedWh,
    meterStartWh,
    latestMeterWh: meterStartWh + deliveredWh,
    deliveredWh,
    powerW: 0,
    startedAt: summary.startedAt,
    stoppedAt: summary.stoppedAt,
    stopReason: summary.stopReason,
    sessionHash,
    txs: { start: MOCK_TX(2), settle: MOCK_TX(3) },
    updatedAt: t(4),
  };

  const proof: ProofResponse = {
    summary,
    canonicalJson: canonicalize(summary),
    sessionHash,
    onchain: { ...settlement, txHash: MOCK_TX(3) },
    verified: true,
  };

  return { node, slot, intent, matches, quote, reservation, session, proof };
}
