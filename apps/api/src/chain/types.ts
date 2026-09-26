/** Chain gateway contract shared by the mock and viem implementations. */
import type { ChainMode, ReservationQuote } from "@chargemesh/shared";
import type { Address, Hex } from "viem";

/** Mirrors `IChargeMeshEscrow.Status` (docs/04-akilli-sozlesme.md). Index = on-chain uint8. */
export const ONCHAIN_STATUSES = [
  "None",
  "Reserved",
  "Active",
  "Settled",
  "Cancelled",
  "Expired",
] as const;
export type OnchainStatus = (typeof ONCHAIN_STATUSES)[number];

export function onchainStatusFromUint8(value: number): OnchainStatus {
  const status = ONCHAIN_STATUSES[value];
  if (!status) throw new Error(`Unknown on-chain status ${value}`);
  return status;
}

/** Decoded `getReservation()` result. Integer amounts are bigint, Wh are numbers. */
export interface OnchainReservation {
  reservationId: Hex;
  slotRef: Hex;
  driver: Address;
  host: Address;
  requestedWh: number;
  deliveredWh: number;
  pricePerKwhWei: bigint;
  depositWei: bigint;
  startTime: bigint;
  endTime: bigint;
  status: OnchainStatus;
  sessionHash: Hex;
}

export type ReserveTxVerification =
  | { ok: true; txHash: Hex; blockNumber: bigint | null }
  | { ok: false; reason: string };

/** Values from the `ReservationSettled` event. */
export interface SettleResult {
  txHash: Hex;
  deliveredWh: number;
  billableWh: number;
  hostAmountWei: bigint;
  refundWei: bigint;
  sessionHash: Hex;
}

export interface ChainGateway {
  readonly mode: ChainMode;
  readonly chainId: number;
  /** Escrow address used as EIP-712 verifyingContract and reserve() target. */
  readonly contractAddress: Address;
  readonly settlerAddress: Address;
  /** EIP-712 signature over `buildQuoteTypedData(quote, chainId, contractAddress)`. */
  signQuote(quote: ReservationQuote): Promise<Hex>;
  /**
   * Checks the reserve() receipt: success, `to === contractAddress`, and a
   * `ReservationCreated` log for `onchainId` (docs/03-api.md, confirm).
   */
  verifyReserveTx(txHash: Hex, onchainId: Hex): Promise<ReserveTxVerification>;
  /** Sends startSession(); resolves with the tx hash after the receipt succeeds. */
  startSession(onchainId: Hex): Promise<Hex>;
  /** Sends settle(); resolves with the decoded ReservationSettled event. */
  settle(onchainId: Hex, deliveredWh: number, sessionHash: Hex): Promise<SettleResult>;
  /** Reads getReservation(); null when the reservation does not exist (status None). */
  readReservation(onchainId: Hex): Promise<OnchainReservation | null>;
}
