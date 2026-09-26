import {
  ChargeIntent,
  ChargingNode,
  EnergySlot,
  PublicChargingNode,
  Reservation,
  type ChargerStatus,
} from "@chargemesh/shared";
import type { IntentDocument, NodeDocument, SlotDocument } from "../db/types";
import type { ReservationDocument } from "../db/types";
import type { Store } from "../db/store";
import type { ChargerRegistry } from "../ocpp/server";

export function nodeOnline(node: NodeDocument, chargers: readonly ChargerStatus[]): boolean {
  return chargers.some((charger) => charger.chargePointId === node.ocppChargePointId && charger.connected);
}

export function toPublicNode(node: NodeDocument, online: boolean) {
  return PublicChargingNode.parse({
    id: node._id,
    hostAddress: node.hostAddress,
    name: node.name,
    areaLabel: node.areaLabel,
    connectorType: node.connectorType,
    maxPowerKw: node.maxPowerKw,
    accessType: node.accessType,
    ocppChargePointId: node.ocppChargePointId,
    ocppConnectorId: node.ocppConnectorId,
    online,
    createdAt: node.createdAt.toISOString(),
  });
}

export function toPrivateNode(node: NodeDocument, online: boolean, webBaseUrl: string) {
  return ChargingNode.parse({
    ...toPublicNode(node, online),
    addressLine: node.addressLine,
    lat: node.lat,
    lng: node.lng,
    accessInstructions: node.accessInstructions,
    startUrl: `${webBaseUrl}/start?cp=${encodeURIComponent(node.ocppChargePointId)}&c=${node.ocppConnectorId}`,
  });
}

export function toEnergySlot(slot: SlotDocument) {
  return EnergySlot.parse({
    id: slot._id,
    nodeId: slot.nodeId,
    slotRef: slot.slotRef,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    maxEnergyWh: slot.maxEnergyWh,
    pricePerKwhWei: slot.pricePerKwhWei,
    status: slot.status,
    createdAt: slot.createdAt.toISOString(),
  });
}

export function toChargeIntent(intent: IntentDocument) {
  return ChargeIntent.parse({
    id: intent._id,
    driverAddress: intent.driverAddress,
    lat: intent.lat,
    lng: intent.lng,
    radiusKm: intent.radiusKm,
    arriveAt: intent.arriveAt.toISOString(),
    departAt: intent.departAt.toISOString(),
    requestedWh: intent.requestedWh,
    connectorType: intent.connectorType,
    acceptedAccessTypes: intent.acceptedAccessTypes,
    createdAt: intent.createdAt.toISOString(),
  });
}

const ACCESS_STATUSES = new Set(["CONFIRMED", "ACTIVE", "COMPLETED", "SETTLED"]);

export async function toReservation(
  store: Store,
  reservation: ReservationDocument,
  viewer: string,
  chargers: ChargerRegistry,
) {
  const slot = await store.findSlot(reservation.slotId);
  if (!slot) throw new Error(`Reservation ${reservation._id} references a missing slot`);
  const node = await store.findNode(slot.nodeId);
  if (!node) throw new Error(`Reservation ${reservation._id} references a missing node`);
  const session = await store.findSessionByReservation(reservation._id);
  const maySeeAccess =
    viewer === reservation.driverAddress && ACCESS_STATUSES.has(reservation.status);

  return Reservation.parse({
    id: reservation._id,
    onchainId: reservation.onchainId,
    intentId: reservation.intentId,
    slotId: reservation.slotId,
    driverAddress: reservation.driverAddress,
    hostAddress: reservation.hostAddress,
    status: reservation.status,
    requestedWh: reservation.requestedWh,
    pricePerKwhWei: reservation.pricePerKwhWei,
    depositWei: reservation.depositWei,
    window: {
      startsAt: reservation.windowStartsAt.toISOString(),
      endsAt: reservation.windowEndsAt.toISOString(),
    },
    holdExpiresAt: reservation.holdExpiresAt.toISOString(),
    node: toPublicNode(node, chargers.isConnected(node.ocppChargePointId)),
    access: maySeeAccess
      ? {
          addressLine: node.addressLine,
          lat: node.lat,
          lng: node.lng,
          accessInstructions: node.accessInstructions,
        }
      : null,
    sessionId: session?._id ?? null,
    txs: {
      reserve: reservation.reserveTxHash,
      start: reservation.startTxHash,
      settle: reservation.settleTxHash,
      cancel: reservation.cancelTxHash,
    },
    settlement:
      reservation.status === "SETTLED" &&
      reservation.settledDeliveredWh !== null &&
      reservation.billableWh !== null &&
      reservation.hostAmountWei !== null &&
      reservation.refundWei !== null &&
      reservation.sessionHash !== null
        ? {
            deliveredWh: reservation.settledDeliveredWh,
            billableWh: reservation.billableWh,
            hostAmountWei: reservation.hostAmountWei,
            refundWei: reservation.refundWei,
            sessionHash: reservation.sessionHash,
          }
        : null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  });
}
