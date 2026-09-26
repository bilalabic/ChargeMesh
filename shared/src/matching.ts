/**
 * Deterministic slot matching (docs/03-api.md, "Eşleştirme algoritması").
 * Pure function: same input => same output. Used by the API and by web mock mode.
 */
import type {
  ChargeIntent,
  EnergySlot,
  MatchResult,
  PublicChargingNode,
} from "./api/schemas";
import { costFor, depositFor } from "./units";

export const MAX_MATCHES = 10;
export const MIN_WINDOW_MS = 15 * 60_000;

export interface MatchCandidate {
  slot: EnergySlot;
  /** Public node fields plus private coordinates (coordinates never leave the API). */
  node: PublicChargingNode & { lat: number; lng: number };
  /** For HELD slots: the hold expiry. Expired holds are treated as OPEN. */
  holdExpiresAt?: string | null;
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isAvailable(c: MatchCandidate, nowMs: number): boolean {
  if (c.slot.status === "OPEN") return true;
  if (c.slot.status === "HELD" && c.holdExpiresAt) return Date.parse(c.holdExpiresAt) <= nowMs;
  return false;
}

interface Scored {
  candidate: MatchCandidate;
  distanceKm: number;
  windowStartMs: number;
  windowEndMs: number;
  deliverableWh: number;
  fullyCovers: boolean;
  quotedWh: number;
  price: bigint;
}

export function rankMatches(
  intent: ChargeIntent,
  candidates: MatchCandidate[],
  now: Date = new Date(),
): MatchResult[] {
  const nowMs = now.getTime();
  const scored: Scored[] = [];

  for (const c of candidates) {
    if (!isAvailable(c, nowMs)) continue;
    if (c.node.connectorType !== intent.connectorType) continue;
    if (!intent.acceptedAccessTypes.includes(c.node.accessType)) continue;

    const distanceKm = haversineKm(intent.lat, intent.lng, c.node.lat, c.node.lng);
    if (distanceKm > intent.radiusKm) continue;

    const windowStartMs = Math.max(Date.parse(c.slot.startsAt), Date.parse(intent.arriveAt));
    const windowEndMs = Math.min(Date.parse(c.slot.endsAt), Date.parse(intent.departAt));
    if (windowEndMs - windowStartMs < MIN_WINDOW_MS) continue;

    const hours = (windowEndMs - windowStartMs) / 3_600_000;
    const deliverableWh = Math.floor(Math.min(c.slot.maxEnergyWh, c.node.maxPowerKw * 1000 * hours));
    if (deliverableWh <= 0) continue;

    const fullyCovers = deliverableWh >= intent.requestedWh;
    scored.push({
      candidate: c,
      distanceKm,
      windowStartMs,
      windowEndMs,
      deliverableWh,
      fullyCovers,
      quotedWh: Math.min(intent.requestedWh, deliverableWh),
      price: BigInt(c.slot.pricePerKwhWei),
    });
  }

  scored.sort((a, b) => {
    if (a.fullyCovers !== b.fullyCovers) return a.fullyCovers ? -1 : 1;
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    if (a.price !== b.price) return a.price < b.price ? -1 : 1;
    if (a.deliverableWh !== b.deliverableWh) return b.deliverableWh - a.deliverableWh;
    const ai = a.candidate.slot.id;
    const bi = b.candidate.slot.id;
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  return scored.slice(0, MAX_MATCHES).map((s, i) => {
    const { lat: _lat, lng: _lng, ...publicNode } = s.candidate.node;
    return {
      rank: i + 1,
      slotId: s.candidate.slot.id,
      node: publicNode,
      distanceKm: Math.round(s.distanceKm * 10) / 10,
      window: {
        startsAt: new Date(s.windowStartMs).toISOString(),
        endsAt: new Date(s.windowEndMs).toISOString(),
      },
      deliverableWh: s.deliverableWh,
      fullyCovers: s.fullyCovers,
      quotedWh: s.quotedWh,
      pricePerKwhWei: s.price.toString(),
      estimatedCostWei: costFor(s.quotedWh, s.price).toString(),
      depositWei: depositFor(s.quotedWh, s.price).toString(),
    };
  });
}
