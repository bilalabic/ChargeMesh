/**
 * REST API v1 contract. Single source of truth for request/response shapes.
 * Human-readable spec: docs/03-api.md. Change only via the contract change protocol
 * (docs/07-paralel-calisma.md).
 */
import { isAddress } from "viem";
import { z } from "zod";
import {
  AccessType,
  ApiErrorCode,
  ChainMode,
  ConnectorType,
  ReservationStatus,
  SessionStatus,
  SlotStatus,
} from "./enums";

// ---------- Primitives ----------

/**
 * EVM address. All-lower-case and all-upper-case hex are accepted as-is; a mixed-case
 * address must carry a valid EIP-55 checksum (catches typos in copy-pasted addresses).
 */
export const Address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address")
  .refine((a) => {
    const body = a.slice(2);
    if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
    return isAddress(a, { strict: true });
  }, "Invalid EIP-55 address checksum");
export const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32-byte hex");
export const HexBytes = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "Expected hex bytes");
/** Wei amount as a non-negative decimal integer string. */
export const WeiString = z.string().regex(/^(0|[1-9]\d*)$/, "Expected decimal integer string");

/** 2^128 - 1: the largest value of a Solidity `uint128` (escrow amounts). */
export const UINT128_MAX_WEI = (1n << 128n) - 1n;
/** Wei amount that fits the escrow's `uint128` fields. */
export const Uint128WeiString = WeiString.refine(
  (v) => BigInt(v) <= UINT128_MAX_WEI,
  "Amount exceeds uint128",
);
/**
 * Upper bound for `pricePerKwhWei` so that the deposit of the largest intent
 * (100_000 Wh, see CreateIntentRequest) still fits uint128:
 * depositFor(100_000, p) = ceil(100_000 * p / 1000) = 100 * p <= 2^128 - 1.
 */
export const MAX_PRICE_PER_KWH_WEI = UINT128_MAX_WEI / 100n;

export const IsoDateTime = z.iso.datetime();
export const Uuid = z.uuid();
export const Wh = z.number().int().nonnegative();
/** Energy in Wh for fields stored on-chain as Solidity `uint32` (0..4_294_967_295). */
export const Uint32Wh = z.number().int().min(0).max(0xffff_ffff);
export const Latitude = z.number().min(-90).max(90);
export const Longitude = z.number().min(-180).max(180);
export const OcppChargePointId = z.string().regex(/^[A-Za-z0-9._-]{3,48}$/);

export const TimeWindow = z.object({
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
});
export type TimeWindow = z.infer<typeof TimeWindow>;

// ---------- Errors ----------

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- System ----------

export const HealthResponse = z.object({
  status: z.literal("ok"),
  chainMode: ChainMode,
  chainId: z.number().int(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const AppConfig = z.object({
  chainId: z.number().int(),
  chainMode: ChainMode,
  contractAddress: Address.nullable(),
  settlerAddress: Address.nullable(),
  explorerUrl: z.url().nullable(),
  quoteTtlSeconds: z.number().int().positive(),
});
export type AppConfig = z.infer<typeof AppConfig>;

export const ChargerStatus = z.object({
  chargePointId: z.string(),
  connected: z.boolean(),
  lastSeenAt: IsoDateTime.nullable(),
  connectorStatus: z.string().nullable(),
});
export type ChargerStatus = z.infer<typeof ChargerStatus>;

// ---------- Charging nodes ----------

export const CreateNodeRequest = z.object({
  name: z.string().trim().min(3).max(80),
  areaLabel: z.string().trim().min(2).max(60),
  addressLine: z.string().trim().min(5).max(200),
  lat: Latitude,
  lng: Longitude,
  connectorType: ConnectorType,
  maxPowerKw: z.number().min(1).max(22),
  accessType: AccessType,
  accessInstructions: z.string().trim().max(500).default(""),
  ocppChargePointId: OcppChargePointId,
  ocppConnectorId: z.number().int().min(1).default(1),
});
export type CreateNodeRequest = z.input<typeof CreateNodeRequest>;
/** After `CreateNodeRequest.parse()`: defaults applied (`accessInstructions`, `ocppConnectorId`). */
export type CreateNodeRequestParsed = z.output<typeof CreateNodeRequest>;

export const PublicChargingNode = z.object({
  id: Uuid,
  hostAddress: Address,
  name: z.string(),
  areaLabel: z.string(),
  connectorType: ConnectorType,
  maxPowerKw: z.number(),
  accessType: AccessType,
  ocppChargePointId: z.string(),
  ocppConnectorId: z.number().int(),
  online: z.boolean(),
  createdAt: IsoDateTime,
});
export type PublicChargingNode = z.infer<typeof PublicChargingNode>;

export const ChargingNode = PublicChargingNode.extend({
  addressLine: z.string(),
  lat: Latitude,
  lng: Longitude,
  accessInstructions: z.string(),
  /** QR payload: `${WEB_BASE_URL}/start?cp={ocppChargePointId}&c={ocppConnectorId}` */
  startUrl: z.url(),
});
export type ChargingNode = z.infer<typeof ChargingNode>;

// ---------- Energy slots ----------

export const CreateSlotRequest = z
  .object({
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    maxEnergyWh: z.number().int().min(1_000).max(200_000),
    pricePerKwhWei: WeiString.refine((v) => BigInt(v) > 0n, "Price must be > 0").refine(
      (v) => BigInt(v) <= MAX_PRICE_PER_KWH_WEI,
      "Price too high: the deposit would not fit uint128",
    ),
  })
  .refine((s) => {
    const ms = Date.parse(s.endsAt) - Date.parse(s.startsAt);
    return ms >= 30 * 60_000 && ms <= 24 * 3_600_000;
  }, "Slot duration must be between 30 minutes and 24 hours")
  // Evaluated at parse time (Date.now()): the same body becomes invalid once endsAt has passed.
  .refine((s) => Date.parse(s.endsAt) > Date.now(), {
    message: "endsAt must be in the future",
    path: ["endsAt"],
  });
export type CreateSlotRequest = z.infer<typeof CreateSlotRequest>;

export const EnergySlot = z.object({
  id: Uuid,
  nodeId: Uuid,
  slotRef: Hex32,
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  maxEnergyWh: Wh,
  pricePerKwhWei: WeiString,
  status: SlotStatus,
  createdAt: IsoDateTime,
});
export type EnergySlot = z.infer<typeof EnergySlot>;

// ---------- Charge intents & matching ----------

export const CreateIntentRequest = z
  .object({
    lat: Latitude,
    lng: Longitude,
    radiusKm: z.number().min(0.5).max(25).default(3),
    arriveAt: IsoDateTime,
    departAt: IsoDateTime,
    requestedWh: z.number().int().min(1_000).max(100_000),
    connectorType: ConnectorType,
    acceptedAccessTypes: z.array(AccessType).min(1).default([...AccessType.options]),
  })
  .refine((i) => {
    const ms = Date.parse(i.departAt) - Date.parse(i.arriveAt);
    return ms >= 15 * 60_000 && ms <= 24 * 3_600_000;
  }, "departAt must be at least 15 minutes and at most 24 hours after arriveAt")
  // Evaluated at parse time (Date.now()): the same body becomes invalid once departAt has passed.
  .refine((i) => Date.parse(i.departAt) > Date.now(), {
    message: "departAt must be in the future",
    path: ["departAt"],
  });
export type CreateIntentRequest = z.input<typeof CreateIntentRequest>;
/** After `CreateIntentRequest.parse()`: defaults applied (`radiusKm`, `acceptedAccessTypes`). */
export type CreateIntentRequestParsed = z.output<typeof CreateIntentRequest>;

export const ChargeIntent = z.object({
  id: Uuid,
  driverAddress: Address,
  lat: Latitude,
  lng: Longitude,
  radiusKm: z.number(),
  arriveAt: IsoDateTime,
  departAt: IsoDateTime,
  requestedWh: Wh,
  connectorType: ConnectorType,
  acceptedAccessTypes: z.array(AccessType),
  createdAt: IsoDateTime,
});
export type ChargeIntent = z.infer<typeof ChargeIntent>;

export const MatchResult = z.object({
  rank: z.number().int().positive(),
  slotId: Uuid,
  node: PublicChargingNode,
  /** Rounded to 0.1 km for display; ranking uses full precision. */
  distanceKm: z.number().nonnegative(),
  window: TimeWindow,
  deliverableWh: Wh,
  fullyCovers: z.boolean(),
  quotedWh: Wh,
  pricePerKwhWei: WeiString,
  estimatedCostWei: WeiString,
  depositWei: WeiString,
});
export type MatchResult = z.infer<typeof MatchResult>;

export const MatchesResponse = z.object({
  intentId: Uuid,
  generatedAt: IsoDateTime,
  matches: z.array(MatchResult).max(10),
});
export type MatchesResponse = z.infer<typeof MatchesResponse>;

// ---------- Reservations ----------

export const ReservationQuote = z.object({
  reservationId: Hex32,
  slotRef: Hex32,
  driver: Address,
  host: Address,
  requestedWh: Uint32Wh,
  pricePerKwhWei: Uint128WeiString,
  depositWei: Uint128WeiString,
  /** Unix seconds */
  startTime: z.number().int().nonnegative(),
  endTime: z.number().int().nonnegative(),
  quoteExpiry: z.number().int().nonnegative(),
});
export type ReservationQuote = z.infer<typeof ReservationQuote>;

export const ReservationAccess = z.object({
  addressLine: z.string(),
  lat: Latitude,
  lng: Longitude,
  accessInstructions: z.string(),
});
export type ReservationAccess = z.infer<typeof ReservationAccess>;

export const Settlement = z.object({
  deliveredWh: Uint32Wh,
  billableWh: Uint32Wh,
  hostAmountWei: Uint128WeiString,
  refundWei: Uint128WeiString,
  sessionHash: Hex32,
});
export type Settlement = z.infer<typeof Settlement>;

export const Reservation = z.object({
  id: Uuid,
  onchainId: Hex32,
  intentId: Uuid,
  slotId: Uuid,
  driverAddress: Address,
  hostAddress: Address,
  status: ReservationStatus,
  requestedWh: Wh,
  pricePerKwhWei: WeiString,
  depositWei: WeiString,
  window: TimeWindow,
  holdExpiresAt: IsoDateTime,
  node: PublicChargingNode,
  /** Only for the driver while CONFIRMED | ACTIVE | COMPLETED | SETTLED. */
  access: ReservationAccess.nullable(),
  sessionId: Uuid.nullable(),
  txs: z.object({
    reserve: Hex32.nullable(),
    start: Hex32.nullable(),
    settle: Hex32.nullable(),
    cancel: Hex32.nullable(),
  }),
  settlement: Settlement.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Reservation = z.infer<typeof Reservation>;

export const CreateReservationRequest = z.object({
  intentId: Uuid,
  slotId: Uuid,
});
export type CreateReservationRequest = z.infer<typeof CreateReservationRequest>;

export const CreateReservationResponse = z.object({
  reservation: Reservation,
  quote: ReservationQuote,
  signature: HexBytes,
  contractAddress: Address,
  chainId: z.number().int(),
});
export type CreateReservationResponse = z.infer<typeof CreateReservationResponse>;

export const ConfirmReservationRequest = z.object({ txHash: Hex32 });
export type ConfirmReservationRequest = z.infer<typeof ConfirmReservationRequest>;

export const SyncReservationRequest = z.object({ txHash: Hex32.optional() });
export type SyncReservationRequest = z.infer<typeof SyncReservationRequest>;

export const ListReservationsQuery = z.object({
  role: z.enum(["driver", "host"]),
});
export type ListReservationsQuery = z.infer<typeof ListReservationsQuery>;

// ---------- Charging sessions ----------

export const StartSessionRequest = z.object({
  chargePointId: z.string().min(1),
  connectorId: z.number().int().min(1),
  reservationId: Uuid.optional(),
});
export type StartSessionRequest = z.infer<typeof StartSessionRequest>;

export const ChargingSession = z.object({
  id: Uuid,
  reservationId: Uuid,
  status: SessionStatus,
  chargePointId: z.string(),
  connectorId: z.number().int(),
  ocppTransactionId: z.number().int().nullable(),
  requestedWh: Wh,
  meterStartWh: Wh.nullable(),
  latestMeterWh: Wh.nullable(),
  deliveredWh: Wh,
  powerW: z.number().int().nonnegative(),
  startedAt: IsoDateTime.nullable(),
  stoppedAt: IsoDateTime.nullable(),
  stopReason: z.string().nullable(),
  sessionHash: Hex32.nullable(),
  txs: z.object({
    start: Hex32.nullable(),
    settle: Hex32.nullable(),
  }),
  updatedAt: IsoDateTime,
});
export type ChargingSession = z.infer<typeof ChargingSession>;

export const MeterEvent = z.object({
  sessionId: Uuid,
  timestamp: IsoDateTime,
  energyWh: Wh,
  deliveredWh: Wh,
  powerW: z.number().int().nonnegative(),
});
export type MeterEvent = z.infer<typeof MeterEvent>;

export const SettledEvent = z.object({
  sessionId: Uuid,
  reservationId: Uuid,
  settlement: Settlement,
});
export type SettledEvent = z.infer<typeof SettledEvent>;

/**
 * SSE event names emitted by GET /sessions/:id/events.
 * The error event is `session.error`, not `error`: an SSE event named `error` collides
 * with EventSource's native `error` event (connection failures), so a listener could not
 * tell a server-sent error from a dropped connection.
 */
export const SESSION_SSE_EVENTS = {
  sessionUpdated: "session.updated",
  meter: "meter",
  settled: "settled",
  error: "session.error",
} as const;
export type SessionSseEventName = (typeof SESSION_SSE_EVENTS)[keyof typeof SESSION_SSE_EVENTS];

/**
 * Payload of the `session.error` SSE event. `code` is normally an `ApiErrorCode` or one of
 * the session-only codes `CHAIN_ERROR` / `CHARGER_ERROR`. It is typed as a plain string on
 * purpose, so a new code on the server does not make older clients reject the event.
 */
export const SessionErrorEvent = z.object({
  code: z.string().min(1),
  message: z.string(),
});
export type SessionErrorEvent = z.infer<typeof SessionErrorEvent>;

// ---------- Proof of Charge ----------

export const PROOF_VERSION = "chargemesh.poc.v1" as const;

export const ProofOfChargeSummary = z.object({
  version: z.literal(PROOF_VERSION),
  chainId: z.number().int(),
  contract: Address,
  reservationId: Hex32,
  chargePointId: z.string(),
  connectorId: z.number().int(),
  ocppTransactionId: z.number().int(),
  startedAt: IsoDateTime,
  stoppedAt: IsoDateTime,
  meterStartWh: Wh,
  meterStopWh: Wh,
  requestedWh: Uint32Wh,
  deliveredWh: Uint32Wh,
  stopReason: z.string(),
  meterSamples: z.object({
    count: z.number().int().nonnegative(),
    samplesHash: Hex32,
  }),
  source: z.literal("ocpp-simulator"),
});
export type ProofOfChargeSummary = z.infer<typeof ProofOfChargeSummary>;

export const ProofResponse = z.object({
  summary: ProofOfChargeSummary,
  canonicalJson: z.string(),
  sessionHash: Hex32,
  onchain: z
    .object({
      sessionHash: Hex32,
      deliveredWh: Uint32Wh,
      billableWh: Uint32Wh,
      hostAmountWei: Uint128WeiString,
      refundWei: Uint128WeiString,
      txHash: Hex32,
    })
    .nullable(),
  verified: z.boolean(),
});
export type ProofResponse = z.infer<typeof ProofResponse>;

// ---------- Demo ----------

export const DemoSeedResponse = z.object({
  node: ChargingNode,
  slot: EnergySlot,
});
export type DemoSeedResponse = z.infer<typeof DemoSeedResponse>;
