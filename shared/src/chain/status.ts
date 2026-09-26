/**
 * On-chain reservation status (Solidity `IChargeMeshEscrow.Status`,
 * docs/04-akilli-sozlesme.md "Tipler"). Values must match the enum order.
 */
import type { ReservationStatus } from "../api/enums";

export const OnchainStatus = {
  None: 0,
  Reserved: 1,
  Active: 2,
  Settled: 3,
  Cancelled: 4,
  Expired: 5,
} as const;
export type OnchainStatusName = keyof typeof OnchainStatus;
export type OnchainStatus = (typeof OnchainStatus)[OnchainStatusName];

const STATUS_NAMES = Object.keys(OnchainStatus) as OnchainStatusName[];

/** `getReservation().status` (uint8) → enum name; `undefined` for out-of-range values. */
export function onchainStatusName(status: number | bigint): OnchainStatusName | undefined {
  const n = Number(status);
  return Number.isInteger(n) ? STATUS_NAMES[n] : undefined;
}

export function isOnchainStatus(status: number | bigint): status is OnchainStatus {
  return onchainStatusName(status) !== undefined;
}

/** User-facing Turkish labels (used by `decodeEscrowError` for `InvalidStatus`). */
export const ONCHAIN_STATUS_LABELS_TR: Record<OnchainStatusName, string> = {
  None: "zincirde bulunamadı",
  Reserved: "rezerve edildi",
  Active: "şarj sürüyor",
  Settled: "ödemesi tamamlandı",
  Cancelled: "iptal edildi",
  Expired: "süresi doldu",
};

const TO_RESERVATION_STATUS: Record<OnchainStatusName, ReservationStatus | null> = {
  None: null,
  Reserved: "CONFIRMED",
  Active: "ACTIVE",
  Settled: "SETTLED",
  Cancelled: "CANCELLED",
  Expired: "EXPIRED",
};

/**
 * The API `ReservationStatus` the backend adopts on `POST /reservations/:id/sync`.
 *
 * `None` (and unknown values) → `null`: the reservation does not exist on-chain,
 * so the backend keeps its own state.
 *
 * `PENDING_PAYMENT`, `HOLD_EXPIRED`, `COMPLETED` and `FAILED` are off-chain-only
 * states and never come from here: the first two exist before `reserve()` lands,
 * `COMPLETED`/`FAILED` describe the gap between the OCPP session ending and a
 * successful `settle()` (on-chain the reservation is still `Active` then).
 * The backend should therefore not downgrade `COMPLETED`/`FAILED` to `ACTIVE`
 * on sync; only terminal on-chain states (`Settled`, `Cancelled`, `Expired`) override them.
 */
export function onchainStatusToReservationStatus(
  status: number | bigint,
): ReservationStatus | null {
  const name = onchainStatusName(status);
  return name === undefined ? null : TO_RESERVATION_STATUS[name];
}
