/**
 * EIP-712 ReservationQuote (docs/04-akilli-sozlesme.md, "EIP-712").
 * Must match the Solidity type string character for character.
 */
import type { ReservationQuote } from "../api/schemas";

export const EIP712_DOMAIN_NAME = "ChargeMesh";
export const EIP712_DOMAIN_VERSION = "1";

export const RESERVATION_QUOTE_TYPESTRING =
  "ReservationQuote(bytes32 reservationId,bytes32 slotRef,address driver,address host,uint32 requestedWh,uint128 pricePerKwhWei,uint128 depositWei,uint64 startTime,uint64 endTime,uint64 quoteExpiry)";

export const reservationQuoteTypes = {
  ReservationQuote: [
    { name: "reservationId", type: "bytes32" },
    { name: "slotRef", type: "bytes32" },
    { name: "driver", type: "address" },
    { name: "host", type: "address" },
    { name: "requestedWh", type: "uint32" },
    { name: "pricePerKwhWei", type: "uint128" },
    { name: "depositWei", type: "uint128" },
    { name: "startTime", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "quoteExpiry", type: "uint64" },
  ],
} as const;

export function getEip712Domain(chainId: number, verifyingContract: `0x${string}`) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const;
}

/**
 * Converts the JSON quote (string/number fields) to the viem-typed struct.
 * Use as the EIP-712 `message` and as the first argument of `reserve()`.
 */
export function quoteToContractArgs(q: ReservationQuote) {
  return {
    reservationId: q.reservationId as `0x${string}`,
    slotRef: q.slotRef as `0x${string}`,
    driver: q.driver as `0x${string}`,
    host: q.host as `0x${string}`,
    requestedWh: q.requestedWh,
    pricePerKwhWei: BigInt(q.pricePerKwhWei),
    depositWei: BigInt(q.depositWei),
    startTime: BigInt(q.startTime),
    endTime: BigInt(q.endTime),
    quoteExpiry: BigInt(q.quoteExpiry),
  };
}

export function buildQuoteTypedData(
  q: ReservationQuote,
  chainId: number,
  verifyingContract: `0x${string}`,
) {
  return {
    domain: getEip712Domain(chainId, verifyingContract),
    types: reservationQuoteTypes,
    primaryType: "ReservationQuote" as const,
    message: quoteToContractArgs(q),
  };
}
