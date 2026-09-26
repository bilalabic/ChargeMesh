import { rankMatches, type MatchResult, type MatchCandidate } from "@chargemesh/shared";
import type { Store } from "../db/store";
import type { ChargerRegistry } from "../ocpp/server";
import { toChargeIntent, toEnergySlot, toPublicNode } from "./views";

export async function findMatches(
  store: Store,
  chargers: ChargerRegistry,
  intentId: string,
  now: Date,
): Promise<MatchResult[]> {
  const intent = await store.findIntent(intentId);
  if (!intent) return [];

  const candidates: MatchCandidate[] = [];
  for (const slot of await store.listMatchableSlots(now)) {
    const node = await store.findNode(slot.nodeId);
    if (!node) continue;
    candidates.push({
      slot: toEnergySlot(slot),
      node: {
        ...toPublicNode(node, chargers.isConnected(node.ocppChargePointId)),
        lat: node.lat,
        lng: node.lng,
      },
      holdExpiresAt: slot.heldUntil?.toISOString() ?? null,
    });
  }
  return rankMatches(toChargeIntent(intent), candidates, now);
}
