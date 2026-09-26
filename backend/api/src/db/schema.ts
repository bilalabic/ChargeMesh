/**
 * Drizzle schema (docs/02-mimari.md, docs/03-api.md, docs/05-ocpp.md).
 * Conventions: money = numeric(78,0) as decimal string, energy = integer Wh,
 * times = timestamptz, EVM addresses/hashes = lower-case text.
 */
import {
  AccessType,
  ConnectorType,
  ReservationStatus,
  SessionStatus,
  SlotStatus,
} from "@chargemesh/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- Helpers ----------

const wei = (name: string) => numeric(name, { precision: 78, scale: 0, mode: "string" });
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Enums (values come from @chargemesh/shared) ----------

/** zod enum options -> non-empty tuple as required by pgEnum. */
const values = <T extends string>(options: readonly T[]) => options as unknown as [T, ...T[]];

export const connectorTypeEnum = pgEnum("connector_type", values(ConnectorType.options));
export const accessTypeEnum = pgEnum("access_type", values(AccessType.options));
export const slotStatusEnum = pgEnum("slot_status", values(SlotStatus.options));
export const reservationStatusEnum = pgEnum("reservation_status", values(ReservationStatus.options));
export const sessionStatusEnum = pgEnum("session_status", values(SessionStatus.options));
export const ocppDirectionEnum = pgEnum("ocpp_direction", ["IN", "OUT"]);
export const ocppMessageKindEnum = pgEnum("ocpp_message_kind", ["CALL", "CALLRESULT", "CALLERROR"]);

/** OCPP transactionId: backend-generated increasing integer (docs/05-ocpp.md). */
export const ocppTransactionIdSeq = pgSequence("ocpp_transaction_id_seq", {
  startWith: 1,
  maxValue: 2_147_483_647, // OCPP 1.6 transactionId is a 32-bit integer
});

// ---------- Charging nodes ----------

export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostAddress: text("host_address").notNull(),
    name: text("name").notNull(),
    areaLabel: text("area_label").notNull(),
    // Private fields: only returned to the owner / confirmed driver, never logged.
    addressLine: text("address_line").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accessInstructions: text("access_instructions").notNull().default(""),
    connectorType: connectorTypeEnum("connector_type").notNull(),
    maxPowerKw: doublePrecision("max_power_kw").notNull(),
    accessType: accessTypeEnum("access_type").notNull(),
    ocppChargePointId: text("ocpp_charge_point_id").notNull(),
    ocppConnectorId: integer("ocpp_connector_id").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("nodes_ocpp_charge_point_id_uq").on(t.ocppChargePointId),
    index("nodes_host_address_idx").on(t.hostAddress),
    check("nodes_host_address_lower", sql`${t.hostAddress} = lower(${t.hostAddress})`),
    check("nodes_ocpp_connector_id_pos", sql`${t.ocppConnectorId} >= 1`),
  ],
);

// ---------- Energy slots ----------

export const slots = pgTable(
  "slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    /** toSlotRef(id), bytes32 hex. */
    slotRef: text("slot_ref").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    maxEnergyWh: integer("max_energy_wh").notNull(),
    pricePerKwhWei: wei("price_per_kwh_wei").notNull(),
    status: slotStatusEnum("status").notNull().default("OPEN"),
    /** Set while HELD: the quote hold expires at this time and the slot is OPEN again. */
    heldUntil: tstz("held_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("slots_slot_ref_uq").on(t.slotRef),
    index("slots_node_starts_idx").on(t.nodeId, t.startsAt),
    index("slots_status_idx").on(t.status),
    check("slots_window", sql`${t.startsAt} < ${t.endsAt}`),
    check("slots_max_energy_pos", sql`${t.maxEnergyWh} > 0`),
    check("slots_price_pos", sql`${t.pricePerKwhWei} > 0`),
  ],
);

// ---------- Charge intents ----------

export const intents = pgTable(
  "intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    driverAddress: text("driver_address").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    radiusKm: doublePrecision("radius_km").notNull(),
    arriveAt: tstz("arrive_at").notNull(),
    departAt: tstz("depart_at").notNull(),
    requestedWh: integer("requested_wh").notNull(),
    connectorType: connectorTypeEnum("connector_type").notNull(),
    acceptedAccessTypes: accessTypeEnum("accepted_access_types").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("intents_driver_address_idx").on(t.driverAddress),
    check("intents_driver_address_lower", sql`${t.driverAddress} = lower(${t.driverAddress})`),
    check("intents_window", sql`${t.arriveAt} < ${t.departAt}`),
  ],
);

// ---------- Reservations ----------

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** toOnchainReservationId(id), bytes32 hex. */
    onchainId: text("onchain_id").notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => intents.id, { onDelete: "restrict" }),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slots.id, { onDelete: "restrict" }),
    driverAddress: text("driver_address").notNull(),
    hostAddress: text("host_address").notNull(),
    status: reservationStatusEnum("status").notNull().default("PENDING_PAYMENT"),
    requestedWh: integer("requested_wh").notNull(),
    pricePerKwhWei: wei("price_per_kwh_wei").notNull(),
    depositWei: wei("deposit_wei").notNull(),
    windowStartsAt: tstz("window_starts_at").notNull(),
    windowEndsAt: tstz("window_ends_at").notNull(),
    /** Equals the quote's quoteExpiry. */
    holdExpiresAt: tstz("hold_expires_at").notNull(),
    quoteSignature: text("quote_signature"),
    reserveTxHash: text("reserve_tx_hash"),
    startTxHash: text("start_tx_hash"),
    settleTxHash: text("settle_tx_hash"),
    cancelTxHash: text("cancel_tx_hash"),
    // Settlement (filled when SETTLED, from the ReservationSettled event).
    settledDeliveredWh: integer("settled_delivered_wh"),
    billableWh: integer("billable_wh"),
    hostAmountWei: wei("host_amount_wei"),
    refundWei: wei("refund_wei"),
    sessionHash: text("session_hash"),
    /** Last settle() error when FAILED (retryable). */
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservations_onchain_id_uq").on(t.onchainId),
    index("reservations_driver_address_idx").on(t.driverAddress),
    index("reservations_host_address_idx").on(t.hostAddress),
    index("reservations_slot_id_idx").on(t.slotId),
    index("reservations_status_idx").on(t.status),
    check("reservations_driver_lower", sql`${t.driverAddress} = lower(${t.driverAddress})`),
    check("reservations_host_lower", sql`${t.hostAddress} = lower(${t.hostAddress})`),
  ],
);

// ---------- Charging sessions ----------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    status: sessionStatusEnum("status").notNull().default("STARTING"),
    chargePointId: text("charge_point_id").notNull(),
    connectorId: integer("connector_id").notNull(),
    /** toOcppIdTag(reservationId), 20 chars. */
    ocppIdTag: text("ocpp_id_tag").notNull(),
    /** nextval(ocpp_transaction_id_seq), assigned on StartTransaction. */
    ocppTransactionId: integer("ocpp_transaction_id"),
    requestedWh: integer("requested_wh").notNull(),
    meterStartWh: integer("meter_start_wh"),
    latestMeterWh: integer("latest_meter_wh"),
    meterStopWh: integer("meter_stop_wh"),
    deliveredWh: integer("delivered_wh").notNull().default(0),
    powerW: integer("power_w").notNull().default(0),
    startedAt: tstz("started_at"),
    stoppedAt: tstz("stopped_at"),
    /** OCPP StopTransaction reason (Remote, EVDisconnected, Local, ...). */
    stopReason: text("stop_reason"),
    /** Proof of Charge canonical JSON and its keccak256. */
    proofCanonicalJson: text("proof_canonical_json"),
    sessionHash: text("session_hash"),
    startTxHash: text("start_tx_hash"),
    settleTxHash: text("settle_tx_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sessions_reservation_id_uq").on(t.reservationId),
    uniqueIndex("sessions_ocpp_transaction_id_uq").on(t.ocppTransactionId),
    index("sessions_charge_point_idx").on(t.chargePointId, t.connectorId),
    index("sessions_ocpp_id_tag_idx").on(t.ocppIdTag),
  ],
);

// ---------- Meter samples (raw MeterValues) ----------

export const meterSamples = pgTable(
  "meter_samples",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    ocppTransactionId: integer("ocpp_transaction_id").notNull(),
    sampledAt: tstz("sampled_at").notNull(),
    /** Energy.Active.Import.Register (Wh). */
    energyWh: integer("energy_wh").notNull(),
    /** Power.Active.Import (W). */
    powerW: integer("power_w").notNull().default(0),
    /** Raw OCPP meterValue entry. */
    raw: jsonb("raw").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
  },
  (t) => [index("meter_samples_session_sampled_idx").on(t.sessionId, t.sampledAt)],
);

// ---------- OCPP message log (debugging) ----------

export const ocppMessages = pgTable(
  "ocpp_messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    chargePointId: text("charge_point_id").notNull(),
    direction: ocppDirectionEnum("direction").notNull(),
    kind: ocppMessageKindEnum("kind").notNull(),
    messageId: text("message_id").notNull(),
    /** CALL action; null for CALLRESULT/CALLERROR frames whose action is unknown. */
    action: text("action"),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ocpp_messages_cp_created_idx").on(t.chargePointId, t.createdAt),
    index("ocpp_messages_message_id_idx").on(t.messageId),
  ],
);

export type NodeRow = typeof nodes.$inferSelect;
export type NewNodeRow = typeof nodes.$inferInsert;
export type SlotRow = typeof slots.$inferSelect;
export type NewSlotRow = typeof slots.$inferInsert;
export type IntentRow = typeof intents.$inferSelect;
export type NewIntentRow = typeof intents.$inferInsert;
export type ReservationRow = typeof reservations.$inferSelect;
export type NewReservationRow = typeof reservations.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MeterSampleRow = typeof meterSamples.$inferSelect;
export type OcppMessageRow = typeof ocppMessages.$inferSelect;
