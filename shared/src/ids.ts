import { keccak256, stringToBytes, type Hex } from "viem";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a hyphenated UUID and returns it lower-cased, so the same id always
 * derives the same on-chain key regardless of how it was spelled. Throws otherwise.
 */
export function canonicalUuid(uuid: string): string {
  if (typeof uuid !== "string" || !UUID_RE.test(uuid)) {
    throw new Error(`Invalid uuid: ${JSON.stringify(uuid)}`);
  }
  return uuid.toLowerCase();
}

/** On-chain reservation key: keccak256(utf8("reservation:" + lowercase uuid)). */
export function toOnchainReservationId(reservationUuid: string): Hex {
  return keccak256(stringToBytes(`reservation:${canonicalUuid(reservationUuid)}`));
}

/** On-chain slot key: keccak256(utf8("slot:" + lowercase uuid)). */
export function toSlotRef(slotUuid: string): Hex {
  return keccak256(stringToBytes(`slot:${canonicalUuid(slotUuid)}`));
}

/** OCPP 1.6 idTag (max 20 chars): "CM" + first 18 hex chars of the uuid, upper-case. */
export function toOcppIdTag(reservationUuid: string): string {
  const compact = canonicalUuid(reservationUuid).replace(/-/g, "").toUpperCase();
  return `CM${compact.slice(0, 18)}`;
}

/** Lower-cases an EVM address for storage and comparison. */
export function normalizeAddress(address: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address: ${address}`);
  return address.toLowerCase() as `0x${string}`;
}
