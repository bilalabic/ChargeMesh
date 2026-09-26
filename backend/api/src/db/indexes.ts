import type { Db } from "mongodb";
import type {
  IntentDocument,
  MeterSampleDocument,
  NodeDocument,
  OcppMessageDocument,
  ReservationDocument,
  SessionDocument,
  SlotDocument,
} from "./types";

export async function ensureMongoIndexes(db: Db): Promise<void> {
  await db.collection<NodeDocument>("nodes").createIndexes([
    { key: { ocppChargePointId: 1 }, name: "nodes_ocpp_charge_point_id_uq", unique: true },
    { key: { hostAddress: 1, createdAt: -1 }, name: "nodes_host_created_idx" },
  ]);
  await db.collection<SlotDocument>("slots").createIndexes([
    { key: { slotRef: 1 }, name: "slots_slot_ref_uq", unique: true },
    { key: { nodeId: 1, startsAt: 1 }, name: "slots_node_starts_idx" },
    { key: { status: 1, heldUntil: 1 }, name: "slots_status_held_idx" },
  ]);
  await db.collection<IntentDocument>("intents").createIndexes([
    { key: { driverAddress: 1, createdAt: -1 }, name: "intents_driver_created_idx" },
  ]);
  await db.collection<ReservationDocument>("reservations").createIndexes([
    { key: { onchainId: 1 }, name: "reservations_onchain_id_uq", unique: true },
    { key: { driverAddress: 1, createdAt: -1 }, name: "reservations_driver_created_idx" },
    { key: { hostAddress: 1, createdAt: -1 }, name: "reservations_host_created_idx" },
    { key: { slotId: 1, status: 1 }, name: "reservations_slot_status_idx" },
    { key: { status: 1, nextRetryAt: 1 }, name: "reservations_retry_idx" },
  ]);
  await db.collection<SessionDocument>("sessions").createIndexes([
    { key: { reservationId: 1 }, name: "sessions_reservation_id_uq", unique: true },
    {
      key: { ocppTransactionId: 1 },
      name: "sessions_ocpp_transaction_id_uq",
      unique: true,
      partialFilterExpression: { ocppTransactionId: { $type: "number" } },
    },
    { key: { chargePointId: 1, connectorId: 1 }, name: "sessions_charge_point_idx" },
    { key: { ocppIdTag: 1 }, name: "sessions_ocpp_id_tag_idx" },
  ]);
  await db.collection<MeterSampleDocument>("meterSamples").createIndexes([
    { key: { sessionId: 1, sampledAt: 1 }, name: "meter_samples_session_sampled_idx" },
    {
      key: { sessionId: 1, sampledAt: 1, energyWh: 1 },
      name: "meter_samples_session_time_energy_uq",
      unique: true,
    },
  ]);
  await db.collection<OcppMessageDocument>("ocppMessages").createIndexes([
    { key: { chargePointId: 1, createdAt: -1 }, name: "ocpp_messages_cp_created_idx" },
    {
      key: { chargePointId: 1, direction: 1, messageId: 1 },
      name: "ocpp_messages_cp_direction_message_uq",
      unique: true,
    },
  ]);
}
