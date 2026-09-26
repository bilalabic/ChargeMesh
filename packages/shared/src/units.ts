/**
 * Integer money/energy math. Must stay byte-for-byte equivalent to ChargeMeshEscrow
 * (docs/04-akilli-sozlesme.md, "Hesaplaşma formülü").
 */
import { formatEther } from "viem";

const WH_PER_KWH = 1000n;

const toBig = (v: bigint | string | number): bigint => (typeof v === "bigint" ? v : BigInt(v));

/** ceil(wh * pricePerKwhWei / 1000) */
export function depositFor(wh: number | bigint, pricePerKwhWei: bigint | string): bigint {
  const numerator = toBig(wh) * toBig(pricePerKwhWei);
  return (numerator + WH_PER_KWH - 1n) / WH_PER_KWH;
}

/** floor(wh * pricePerKwhWei / 1000) */
export function costFor(wh: number | bigint, pricePerKwhWei: bigint | string): bigint {
  return (toBig(wh) * toBig(pricePerKwhWei)) / WH_PER_KWH;
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

export function computeSettlement(input: SettlementInput): SettlementResult {
  const billableWh = Math.min(input.deliveredWh, input.requestedWh);
  const deposit = toBig(input.depositWei);
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
  return `${formatEther(toBig(wei))} ${symbol}`;
}
