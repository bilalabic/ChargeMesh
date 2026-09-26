/**
 * Typed helpers for ChargeMeshEscrow events (docs/04-akilli-sozlesme.md, "Olaylar").
 * Platform-agnostic: only viem, no Node or DOM APIs.
 */
import {
  encodeEventTopics,
  formatLog,
  parseEventLogs,
  type Address,
  type BlockNumber,
  type BlockTag,
  type Hex,
  type Log,
  type LogTopic,
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
 * A reverted receipt always returns `null`. `status` may be viem's formatted value
 * (`"success"` / `"reverted"`) or the raw JSON-RPC value (`"0x1"` / `"0x0"`); any other
 * value is treated as not successful. The caller still checks
 * `receipt.to === escrow` and compares the event fields with the stored quote.
 */
export function findReservationCreated(
  receipt: { logs: readonly (Log | RpcLog)[]; status?: string },
  reservationId: Hex,
  escrow: Address,
): ReservationCreatedLog | null {
  if (receipt.status !== undefined && receipt.status !== "success" && receipt.status !== "0x1") {
    return null;
  }
  const events = parseEscrowEvents(receipt.logs, { escrow });
  const found = events.find(
    (e): e is ReservationCreatedLog =>
      e.eventName === "ReservationCreated" &&
      e.args.reservationId.toLowerCase() === reservationId.toLowerCase(),
  );
  return found ?? null;
}

/**
 * `deployBlock` of the synced deployment whose escrow matches (a lower bound, see
 * "Deploy bloğu"), or `null` when `escrow` is not a known deployment.
 */
export function escrowDeployBlock(escrow: Address): bigint | null {
  for (const d of Object.values(deployments)) {
    if (d && sameAddress(d.escrow, escrow)) return d.deployBlock;
  }
  return null;
}

// ---------- Chunked eth_getLogs ----------

/**
 * Monad public RPCs cap `eth_getLogs` at 100 blocks per request and do not offer
 * filter RPCs (`eth_newFilter`), so scans are split into ranges of at most this size.
 */
export const DEFAULT_MAX_BLOCK_RANGE = 100n;

export interface LogsChunkProgress {
  /** Inclusive range of the chunk that just finished. */
  fromBlock: bigint;
  toBlock: bigint;
  /** Blocks scanned so far / in total. */
  scannedBlocks: bigint;
  totalBlocks: bigint;
  /** Logs found so far. */
  logs: number;
}

export interface ChunkedScanOptions {
  /** Blocks per `eth_getLogs` call (inclusive range size). Default 100 (Monad public RPC limit). */
  maxBlockRange?: bigint | number;
  /** Called after every chunk. */
  onProgress?: (progress: LogsChunkProgress) => void;
  /** Extra attempts per chunk on transient errors (timeouts, 429/5xx, rate limits). Default 2. */
  retries?: number;
  /** Base delay between attempts in ms, multiplied by the attempt number. Default 250. */
  retryDelayMs?: number;
}

export interface FetchLogsChunkedParams extends ChunkedScanOptions {
  address?: Address | Address[];
  /** Raw topic filter, e.g. `[[sigA, sigB], reservationId]` (OR inside a position). */
  topics?: LogTopic[];
  /** Inclusive block range. */
  fromBlock: bigint;
  toBlock: bigint;
}

type GetLogsClient = Pick<PublicClient, "request">;

const TRANSIENT_RPC_CODES = new Set([-32005, -32603, -32000, 429]);
const TRANSIENT_ERROR_NAMES = new Set([
  "HttpRequestError",
  "TimeoutError",
  "SocketClosedError",
  "WebSocketRequestError",
  "LimitExceededRpcError",
  "InternalRpcError",
]);

/** Best-effort classification of retryable RPC errors (walks the `cause` chain). */
export function isTransientRpcError(err: unknown): boolean {
  let node: unknown = err;
  for (let depth = 0; depth < 8 && typeof node === "object" && node !== null; depth++) {
    const o = node as { name?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    if (typeof o.name === "string" && TRANSIENT_ERROR_NAMES.has(o.name)) return true;
    if (typeof o.code === "number" && TRANSIENT_RPC_CODES.has(o.code)) return true;
    if (typeof o.status === "number" && (o.status === 429 || o.status >= 500)) return true;
    node = o.cause;
  }
  return false;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `eth_getLogs` over an inclusive block range, split into consecutive chunks of at most
 * `maxBlockRange` blocks (no gaps, no overlaps). Chunks run sequentially; each chunk is
 * retried a few times on transient errors. Returns formatted (bigint) logs in chain order.
 */
export async function fetchLogsChunked(
  client: GetLogsClient,
  params: FetchLogsChunkedParams,
): Promise<Log[]> {
  const { address, topics, fromBlock, toBlock, onProgress } = params;
  const range = BigInt(params.maxBlockRange ?? DEFAULT_MAX_BLOCK_RANGE);
  const retries = params.retries ?? 2;
  const retryDelayMs = params.retryDelayMs ?? 250;
  if (range < 1n) throw new RangeError("maxBlockRange must be >= 1");
  if (fromBlock < 0n) throw new RangeError("fromBlock must be >= 0");
  if (fromBlock > toBlock) return [];

  const totalBlocks = toBlock - fromBlock + 1n;
  const out: Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += range) {
    const end = start + range - 1n < toBlock ? start + range - 1n : toBlock;
    let attempt = 0;
    for (;;) {
      try {
        const raw = await client.request({
          method: "eth_getLogs",
          params: [
            {
              address,
              topics,
              fromBlock: `0x${start.toString(16)}`,
              toBlock: `0x${end.toString(16)}`,
            },
          ],
        });
        for (const log of raw as unknown as RpcLog[]) out.push(formatLog(log));
        break;
      } catch (err) {
        if (attempt >= retries || !isTransientRpcError(err)) throw err;
        attempt++;
        await delay(retryDelayMs * attempt);
      }
    }
    onProgress?.({
      fromBlock: start,
      toBlock: end,
      scannedBlocks: end - fromBlock + 1n,
      totalBlocks,
      logs: out.length,
    });
  }
  return out;
}

/** topic0 of every reservation-scoped event, in RESERVATION_EVENT_NAMES order. */
export const RESERVATION_EVENT_TOPICS: readonly Hex[] = RESERVATION_EVENT_NAMES.map(
  (eventName) => encodeEventTopics({ abi: chargeMeshEscrowAbi, eventName })[0] as Hex,
);

/**
 * All reservation-scoped events (`ReservationCreated`, `SessionStarted`,
 * `ReservationSettled`, `ReservationCancelled`, `ReservationExpired`) for one
 * reservation, oldest first.
 *
 * Uses one `eth_getLogs` per chunk with the topic filter
 * `[[five event signatures], reservationId]` (every one of these events has
 * `reservationId` as its first indexed argument), chunked by `maxBlockRange`
 * (default 100, the Monad public RPC limit).
 *
 * - `fromBlock` defaults to the synced deployment's `deployBlock`; for an escrow that
 *   is not a known deployment it is **required** (throws otherwise) to avoid scanning
 *   from block 0.
 * - `toBlock` defaults to the latest block number, fetched once at the start. A tag
 *   (`"latest"`, `"safe"`, `"finalized"`) is resolved to a number once as well.
 */
export async function getEscrowEventsForReservation(
  client: Pick<PublicClient, "request" | "getBlockNumber" | "getBlock">,
  params: {
    escrow: Address;
    reservationId: Hex;
    fromBlock?: BlockNumber;
    toBlock?: BlockNumber | BlockTag;
  } & ChunkedScanOptions,
): Promise<ReservationEventLog[]> {
  const { escrow, reservationId } = params;
  const fromBlock = params.fromBlock ?? escrowDeployBlock(escrow);
  if (fromBlock === null) {
    throw new Error(
      `getEscrowEventsForReservation: ${escrow} is not a known deployment; pass fromBlock explicitly`,
    );
  }
  const toBlock = await resolveBlockNumber(client, params.toBlock ?? "latest");

  const logs = await fetchLogsChunked(client, {
    address: escrow,
    topics: [[...RESERVATION_EVENT_TOPICS], reservationId],
    fromBlock,
    toBlock,
    maxBlockRange: params.maxBlockRange,
    onProgress: params.onProgress,
    retries: params.retries,
    retryDelayMs: params.retryDelayMs,
  });

  const wanted = reservationId.toLowerCase();
  const events = parseEscrowEvents(logs, { escrow }).filter(
    (e): e is ReservationEventLog =>
      (RESERVATION_EVENT_NAMES as readonly string[]).includes(e.eventName) &&
      (e.args as { reservationId?: Hex }).reservationId?.toLowerCase() === wanted,
  );
  return events.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );
}

async function resolveBlockNumber(
  client: Pick<PublicClient, "getBlockNumber" | "getBlock">,
  block: BlockNumber | BlockTag,
): Promise<bigint> {
  if (typeof block === "bigint") return block;
  if (block === "latest") return client.getBlockNumber({ cacheTime: 0 });
  if (block === "earliest") return 0n;
  const b = await client.getBlock({ blockTag: block });
  if (b.number === null) throw new Error(`Block "${block}" has no number yet`);
  return b.number;
}
