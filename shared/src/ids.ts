import { keccak256, stringToBytes, type Hex } from "viem";

/** On-chain reservation key: keccak256(utf8("reservation:" + uuid)). */
export function toOnchainReservationId(reservationUuid: string): Hex {
  return keccak256(stringToBytes(`reservation:${reservationUuid}`));
}

/** On-chain slot key: keccak256(utf8("slot:" + uuid)). */
export function toSlotRef(slotUuid: string): Hex {
  return keccak256(stringToBytes(`slot:${slotUuid}`));
}

/** OCPP 1.6 idTag (max 20 chars): "CM" + first 18 hex chars of the uuid, upper-case. */
export function toOcppIdTag(reservationUuid: string): string {
  const compact = reservationUuid.replace(/-/g, "").toUpperCase();
  if (compact.length < 18) throw new Error("Invalid reservation uuid");
  return `CM${compact.slice(0, 18)}`;
}

/** Lower-cases an EVM address for storage and comparison. */
export function normalizeAddress(address: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address: ${address}`);
  return address.toLowerCase() as `0x${string}`;
}
