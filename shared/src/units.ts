/**
 * Integer money/energy math. Must stay byte-for-byte equivalent to ChargeMeshEscrow
 * (docs/04-akilli-sozlesme.md, "Hesaplaşma formülü").
 */
import { formatEther } from "viem";

const WH_PER_KWH = 1000n;
export const UINT32_MAX = 0xffff_ffff;
export const UINT128_MAX = (1n << 128n) - 1n;

const DECIMAL_INT = /^(0|[1-9]\d*)$/;

/**
 * Strict non-negative integer conversion:
 * - string: canonical decimal (`^(0|[1-9]\d*)$`; no sign, whitespace, hex, exponent or leading zeros)
 * - number: non-negative safe integer
 * - bigint: non-negative
 * Anything else throws instead of being silently coerced by `BigInt()`.
 */
export function toBig(v: bigint | string | number, label = "value"): bigint {
  if (typeof v === "bigint") {
    if (v < 0n) throw new RangeError(`${label} must be non-negative, got ${v}`);
    return v;
  }
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new RangeError(`${label} must be a non-negative safe integer, got ${v}`);
    }
    return BigInt(v);
  }
  if (typeof v === "string") {
    if (!DECIMAL_INT.test(v)) {
      throw new RangeError(`${label} must be a non-negative decimal integer string, got ${JSON.stringify(v)}`);
    }
    return BigInt(v);
  }
  throw new TypeError(`${label} must be a bigint, string or number, got ${typeof v}`);
}

/** Throws unless `v` is an integer in [0, 2^32-1] (Solidity `uint32`). */
export function assertUint32(v: number, label = "value"): number {
  if (!Number.isSafeInteger(v) || v < 0 || v > UINT32_MAX) {
    throw new RangeError(`${label} must be an integer in [0, ${UINT32_MAX}], got ${v}`);
  }
  return v;
}

/** ceil(wh * pricePerKwhWei / 1000) */
export function depositFor(wh: number | bigint, pricePerKwhWei: bigint | string): bigint {
  const numerator = toBig(wh, "wh") * toBig(pricePerKwhWei, "pricePerKwhWei");
  return (numerator + WH_PER_KWH - 1n) / WH_PER_KWH;
}

/** floor(wh * pricePerKwhWei / 1000) */
export function costFor(wh: number | bigint, pricePerKwhWei: bigint | string): bigint {
  return (toBig(wh, "wh") * toBig(pricePerKwhWei, "pricePerKwhWei")) / WH_PER_KWH;
}

export interface SettlementInput {
  requestedWh: number;
  deliveredWh: number;
  pricePerKwhWei: bigint | string;
  depositWei: bigint | string;
}

export interface SettlementResult {
  billableWh: number;
  hostAmountWei: bigint;
  refundWei: bigint;
}

/** Mirrors `settle()`: `requestedWh`/`deliveredWh` must be uint32 (the contract's argument types). */
export function computeSettlement(input: SettlementInput): SettlementResult {
  const requestedWh = assertUint32(input.requestedWh, "requestedWh");
  const deliveredWh = assertUint32(input.deliveredWh, "deliveredWh");
  const billableWh = Math.min(deliveredWh, requestedWh);
  const deposit = toBig(input.depositWei, "depositWei");
  const raw = costFor(billableWh, input.pricePerKwhWei);
  const hostAmountWei = raw < deposit ? raw : deposit;
  return { billableWh, hostAmountWei, refundWei: deposit - hostAmountWei };
}

/** Display only. */
export function whToKwh(wh: number): number {
  return wh / 1000;
}

/** Display only, e.g. formatMon(200000000000000000n) === "0.2 MON". */
export function formatMon(wei: bigint | string, symbol = "MON"): string {
  return `${formatEther(toBig(wei, "wei"))} ${symbol}`;
}
