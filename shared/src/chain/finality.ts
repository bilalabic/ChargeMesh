/**
 * Waiting for finality on Monad (MonadBFT): a block is finalized about two blocks
 * (~600-800 ms) after it is proposed. A receipt seen at "latest" can still be
 * replaced by a reorg until then, so money-moving decisions (e.g. `confirm`,
 * marking a reservation SETTLED) should wait for `waitForFinalized`.
 * Platform-agnostic: only viem, no Node or DOM APIs.
 */
import type { Block, Hash, PublicClient, TransactionReceipt } from "viem";

export type FinalityClient = Pick<PublicClient, "getBlock" | "getTransactionReceipt">;

export interface WaitForFinalizedOptions {
  /** Poll interval for `getBlock({ blockTag: "finalized" })`. Default 250 ms. */
  pollMs?: number;
  /** Give up after this long. Default 15 000 ms. */
  timeoutMs?: number;
}

/** The observed block (or the transaction's block) was replaced before it was finalized. */
export class ReorgDetectedError extends Error {
  override readonly name = "ReorgDetectedError";
  constructor(
    readonly blockNumber: bigint,
    readonly expectedBlockHash: Hash,
    /** Hash now at that height / of the tx's new block; `null` if the tx is no longer found. */
    readonly actualBlockHash: Hash | null,
    readonly txHash?: Hash,
  ) {
    super(
      txHash
        ? `Reorg detected for tx ${txHash}: block ${blockNumber} hash ${expectedBlockHash} -> ${actualBlockHash ?? "tx not found"}`
        : `Reorg detected at block ${blockNumber}: ${expectedBlockHash} -> ${actualBlockHash ?? "missing"}`,
    );
  }
}

export class FinalityTimeoutError extends Error {
  override readonly name = "FinalityTimeoutError";
  constructor(
    readonly target: bigint | Hash,
    readonly timeoutMs: number,
  ) {
    super(`Not finalized within ${timeoutMs} ms: ${String(target)}`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isReceiptNotFound = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  (err as { name?: unknown }).name === "TransactionReceiptNotFoundError";

/**
 * Waits until the transaction `hash` (or the block `blockNumber`) is finalized.
 *
 * Polls `getBlock({ blockTag: "finalized" })` until `finalized.number >= target`, then
 * re-fetches the receipt (or block) and checks that its `blockHash` is unchanged;
 * a change means the block was reorged out and throws `ReorgDetectedError`.
 *
 * - `{ hash }` resolves with the finalized receipt. A receipt that is not yet
 *   available is polled for as well (within the same timeout).
 * - `{ blockNumber }` resolves with the finalized block.
 * Throws `FinalityTimeoutError` after `timeoutMs`.
 */
export function waitForFinalized(
  client: FinalityClient,
  options: { hash: Hash } & WaitForFinalizedOptions,
): Promise<TransactionReceipt>;
export function waitForFinalized(
  client: FinalityClient,
  options: { blockNumber: bigint } & WaitForFinalizedOptions,
): Promise<Block>;
export async function waitForFinalized(
  client: FinalityClient,
  options: ({ hash: Hash } | { blockNumber: bigint }) & WaitForFinalizedOptions,
): Promise<TransactionReceipt | Block> {
  const pollMs = options.pollMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  const target = "hash" in options ? options.hash : options.blockNumber;

  const waitOrTimeout = async () => {
    if (Date.now() + pollMs > deadline) throw new FinalityTimeoutError(target, timeoutMs);
    await sleep(pollMs);
  };

  // 1. What we observed before finality.
  let blockNumber: bigint;
  let blockHash: Hash;
  if ("hash" in options) {
    let receipt: TransactionReceipt | undefined;
    while (!receipt) {
      try {
        receipt = await client.getTransactionReceipt({ hash: options.hash });
      } catch (err) {
        if (!isReceiptNotFound(err)) throw err;
        await waitOrTimeout();
      }
    }
    blockNumber = receipt.blockNumber;
    blockHash = receipt.blockHash;
  } else {
    blockNumber = options.blockNumber;
    const block = await client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`Block ${blockNumber} has no hash yet`);
    blockHash = block.hash;
  }

  // 2. Wait for the finalized head to reach that height.
  for (;;) {
    const finalized = await client.getBlock({ blockTag: "finalized" });
    if (finalized.number !== null && finalized.number >= blockNumber) break;
    await waitOrTimeout();
  }

  // 3. Re-check: the block we saw must be the one that got finalized.
  if ("hash" in options) {
    let receipt: TransactionReceipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: options.hash });
    } catch (err) {
      if (isReceiptNotFound(err)) throw new ReorgDetectedError(blockNumber, blockHash, null, options.hash);
      throw err;
    }
    if (receipt.blockHash.toLowerCase() !== blockHash.toLowerCase()) {
      throw new ReorgDetectedError(blockNumber, blockHash, receipt.blockHash, options.hash);
    }
    return receipt;
  }
  const block = await client.getBlock({ blockNumber });
  if (!block.hash || block.hash.toLowerCase() !== blockHash.toLowerCase()) {
    throw new ReorgDetectedError(blockNumber, blockHash, block.hash);
  }
  return block;
}
