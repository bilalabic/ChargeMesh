/**
 * Proof of Charge canonical JSON + hash (docs/03-api.md, "Proof of Charge").
 * sessionHash = keccak256(utf8(canonicalize(summary)))
 */
import { keccak256, stringToBytes, type Hex } from "viem";
import type { ProofOfChargeSummary } from "./api/schemas";

/**
 * Deterministic JSON, built by hand (not via `JSON.stringify` on objects) so the
 * output is specified exactly and reproducible in other languages:
 *
 * - Object keys are sorted at every level by UTF-16 code units, exactly like
 *   `Object.keys(o).sort()`; integer-like keys ("10", "2") are sorted as strings too
 *   (`JSON.stringify` would move them first in ascending numeric order).
 * - No whitespace. Allowed values: string, safe integer, boolean, null, dense array,
 *   plain object (prototype `Object.prototype` or `null`).
 * - Rejected: non-integer or unsafe numbers, `undefined`, bigint, functions, symbols,
 *   sparse arrays, `Date`/`Map`/class instances, accessor properties, symbol keys, cycles.
 * - Strings (values and keys) are emitted with `JSON.stringify(string)` and hashed
 *   as-is: no Unicode normalization is applied, so NFC and NFD spellings differ.
 * - `-0` is emitted as `0`.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, "$", new Set());
}

function serialize(value: unknown, path: string, stack: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonicalize: non-integer or unsafe number at ${path}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "object":
      break;
    default:
      throw new Error(`canonicalize: unsupported ${typeof value} at ${path}`);
  }

  const obj = value as object;
  if (stack.has(obj)) throw new Error(`canonicalize: circular reference at ${path}`);
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!Object.hasOwn(obj, i)) throw new Error(`canonicalize: sparse array at ${path}[${i}]`);
        parts.push(serialize(obj[i], `${path}[${i}]`, stack));
      }
      return `[${parts.join(",")}]`;
    }

    const proto: unknown = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      const name = (obj as { constructor?: { name?: unknown } }).constructor?.name;
      throw new Error(`canonicalize: non-plain object (${String(name ?? "unknown")}) at ${path}`);
    }
    if (Object.getOwnPropertySymbols(obj).length > 0) {
      throw new Error(`canonicalize: symbol keys are not allowed at ${path}`);
    }

    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      // Read through the descriptor so an own "__proto__" key is read as data, never as the prototype.
      const desc = Object.getOwnPropertyDescriptor(obj, key);
      if (!desc || !("value" in desc)) {
        throw new Error(`canonicalize: accessor property at ${path}.${key}`);
      }
      parts.push(`${JSON.stringify(key)}:${serialize(desc.value, `${path}.${key}`, stack)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    stack.delete(obj);
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
