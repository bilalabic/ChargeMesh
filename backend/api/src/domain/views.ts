import {
  ChargeIntent,
  ChargingNode,
  EnergySlot,
  PublicChargingNode,
  type ChargerStatus,
} from "@chargemesh/shared";
import type { IntentDocument, NodeDocument, SlotDocument } from "../db/types";

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
