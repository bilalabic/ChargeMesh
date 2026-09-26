/**
 * Typed helpers for ChargeMeshEscrow events (docs/04-akilli-sozlesme.md, "Olaylar").
 * Platform-agnostic: only viem, no Node or DOM APIs.
 */
import {
  parseEventLogs,
  type Address,
  type BlockNumber,
  type BlockTag,
  type Hex,
  type Log,
  type PublicClient,
  type RpcLog,
} from "viem";
import { chargeMeshEscrowAbi } from "./abi";
import { deployments } from "./deployments";

type EscrowAbi = typeof chargeMeshEscrowAbi;

/** Any decoded escrow event (discriminate on `eventName`). */
export type EscrowEventLog = ReturnType<typeof parseEventLogs<EscrowAbi, true, undefined>>[number];

/** Events that carry an indexed `reservationId`. */
export const RESERVATION_EVENT_NAMES = [
  "ReservationCreated",
  "SessionStarted",
  "ReservationSettled",
  "ReservationCancelled",
  "ReservationExpired",
] as const;
export type ReservationEventName = (typeof RESERVATION_EVENT_NAMES)[number];
export type ReservationEventLog = Extract<EscrowEventLog, { eventName: ReservationEventName }>;
export type ReservationCreatedLog = Extract<EscrowEventLog, { eventName: "ReservationCreated" }>;

const sameAddress = (a: string | null | undefined, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Decodes escrow events from raw logs (e.g. `receipt.logs`). Logs that do not
 * match the escrow ABI are skipped. Pass `escrow` to ignore logs emitted by
 * other contracts (a different contract can emit an event with the same signature).
 */
export function parseEscrowEvents(
  logs: readonly (Log | RpcLog)[],
  options: { escrow?: Address } = {},
): EscrowEventLog[] {
  const { escrow } = options;
  const own = escrow ? logs.filter((l) => sameAddress(l.address, escrow)) : logs;
  return parseEventLogs({ abi: chargeMeshEscrowAbi, logs: [...own] });
}

/**
 * For backend `POST /reservations/:id/confirm`: the `ReservationCreated` event
 * for `reservationId` emitted by `escrow` in this receipt, or `null`.
 * A reverted receipt always returns `null`. The caller still checks
 * `receipt.to === escrow` and compares the event fields with the stored quote.
 */
export function findReservationCreated(
  receipt: { logs: readonly (Log | RpcLog)[]; status?: string },
  reservationId: Hex,
  escrow: Address,
): ReservationCreatedLog | null {
  if (receipt.status !== undefined && receipt.status !== "success") return null;
  const events = parseEscrowEvents(receipt.logs, { escrow });
  const found = events.find(
    (e): e is ReservationCreatedLog =>
      e.eventName === "ReservationCreated" &&
      e.args.reservationId.toLowerCase() === reservationId.toLowerCase(),
  );
  return found ?? null;
}

/** Lower bound for event scans: `deployBlock` of the deployment whose escrow matches, else `0n`. */
export function escrowDeployBlock(escrow: Address): bigint {
  for (const d of Object.values(deployments)) {
    if (d && sameAddress(d.escrow, escrow)) return d.deployBlock;
  }
  return 0n;
}

/**
 * All reservation-scoped events (`ReservationCreated`, `SessionStarted`,
 * `ReservationSettled`, `ReservationCancelled`, `ReservationExpired`) for one
 * reservation, oldest first. `fromBlock` defaults to the deployment's
 * `deployBlock` (a lower bound, see "Deploy bloğu"). Public RPCs may cap the
 * `eth_getLogs` block range; narrow it with `fromBlock`/`toBlock` if needed.
 */
export async function getEscrowEventsForReservation(
  client: Pick<PublicClient, "getContractEvents">,
  params: {
    escrow: Address;
    reservationId: Hex;
    fromBlock?: BlockNumber | BlockTag;
    toBlock?: BlockNumber | BlockTag;
  },
): Promise<ReservationEventLog[]> {
  const { escrow, reservationId, toBlock } = params;
  const fromBlock = params.fromBlock ?? escrowDeployBlock(escrow);
  const batches = await Promise.all(
    RESERVATION_EVENT_NAMES.map((eventName) =>
      client.getContractEvents({
        address: escrow,
        abi: chargeMeshEscrowAbi,
        eventName,
        args: { reservationId },
        fromBlock,
        toBlock,
        strict: true,
      }),
    ),
  );
  const logs = batches.flat() as ReservationEventLog[];
  return logs.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}
