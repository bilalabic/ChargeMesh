/**
 * Proof of Charge canonical JSON + hash (docs/03-api.md, "Proof of Charge").
 * sessionHash = keccak256(utf8(canonicalize(summary)))
 */
import { keccak256, stringToBytes, type Hex } from "viem";
import type { ProofOfChargeSummary } from "./api/schemas";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Deterministic JSON: sorted keys at every level, no whitespace, integers only. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value, "$"));
}

function normalize(value: unknown, path: string): Json {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonicalize: non-integer number at ${path}`);
      }
      return value;
    case "object": {
      if (Array.isArray(value)) return value.map((v, i) => normalize(v, `${path}[${i}]`));
      const out: { [key: string]: Json } = {};
      for (const key of Object.keys(value as object).sort()) {
        out[key] = normalize((value as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return out;
    }
    default:
      throw new Error(`canonicalize: unsupported ${typeof value} at ${path}`);
  }
}

export function hashCanonical(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalize(value)));
}

export function computeSessionHash(summary: ProofOfChargeSummary): Hex {
  return hashCanonical(summary);
}

export interface MeterSampleForHash {
  timestamp: string;
  energyWh: number;
  powerW: number;
}

/** Hash of the raw meter sample list, embedded in the summary as meterSamples.samplesHash. */
export function computeSamplesHash(samples: MeterSampleForHash[]): Hex {
  return hashCanonical(samples);
}
