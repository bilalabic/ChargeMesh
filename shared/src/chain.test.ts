import { describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  RawContractError,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type RpcLog,
} from "viem";
import {
  chargeMeshEscrowAbi,
  decodeEscrowError,
  ESCROW_ERROR_MESSAGES_TR,
  escrowDeployBlock,
  fetchLogsChunked,
  FinalityTimeoutError,
  findReservationCreated,
  isTransientRpcError,
  RESERVATION_EVENT_TOPICS,
  ReorgDetectedError,
  waitForFinalized,
  getDeployment,
  getEscrowEventsForReservation,
  OnchainStatus,
  onchainStatusName,
  onchainStatusToReservationStatus,
  parseEscrowEvents,
  toOnchainReservationId,
  type EscrowErrorName,
} from "./index";

// Use the synced testnet deployment so these tests survive redeploys.
const TESTNET = getDeployment(10143);
if (!TESTNET) throw new Error("chain 10143 deployment missing; run chain:sync");
const ESCROW: Address = TESTNET.escrow;
const OTHER: Address = "0x1111111111111111111111111111111111111111";

const abiErrors = chargeMeshEscrowAbi.filter((x) => x.type === "error");

/** Sample arguments per error input type. */
function sampleArgs(inputs: readonly { type: string }[]): unknown[] {
  return inputs.map((i) => {
    if (i.type === "uint8") return OnchainStatus.Cancelled;
    if (i.type === "address") return OTHER;
    if (i.type === "string") return "x";
    throw new Error(`no sample for ${i.type}`);
  });
}

function revertData(name: EscrowErrorName, args: readonly unknown[]): Hex {
  return encodeErrorResult({
    abi: chargeMeshEscrowAbi as Abi,
    errorName: name,
    args: args as unknown[],
  });
}

describe("escrow errors", () => {
  it("has a non-empty Turkish message for every ABI error", () => {
    expect(abiErrors.length).toBeGreaterThan(0);
    for (const e of abiErrors) {
      const msg = ESCROW_ERROR_MESSAGES_TR[e.name as EscrowErrorName];
      expect(msg, e.name).toBeTypeOf("string");
      expect(msg.trim().length, e.name).toBeGreaterThan(0);
    }
    expect(Object.keys(ESCROW_ERROR_MESSAGES_TR).sort()).toEqual(abiErrors.map((e) => e.name).sort());
  });

  it.each(abiErrors.map((e) => [e.name, e] as const))("decodes %s from raw revert data", (name, e) => {
    const args = sampleArgs(e.inputs);
    const decoded = decodeEscrowError(revertData(name, args));
    expect(decoded?.name).toBe(name);
    expect(decoded?.args).toEqual(args);
    expect(decoded?.message.length).toBeGreaterThan(0);
  });

  it("renders the current status for InvalidStatus", () => {
    const decoded = decodeEscrowError(revertData("InvalidStatus", [OnchainStatus.Settled]));
    expect(decoded?.name).toBe("InvalidStatus");
    expect(decoded?.args).toEqual([3]);
    expect(decoded?.message).toBe(
      "Rezervasyon bu işlem için uygun durumda değil. Şu anki durumu: ödemesi tamamlandı.",
    );
  });

  it("decodes from a viem ContractFunctionExecutionError (writeContract / simulate shape)", () => {
    const data = revertData("TooLate", []);
    const reverted = new ContractFunctionRevertedError({
      abi: chargeMeshEscrowAbi as Abi,
      data,
      functionName: "cancel",
    });
    expect(reverted.data?.errorName).toBe("TooLate");
    const err = new ContractFunctionExecutionError(reverted, {
      abi: chargeMeshEscrowAbi as Abi,
      args: [RES_ID],
      functionName: "cancel",
      contractAddress: ESCROW,
    });
    expect(decodeEscrowError(err)).toEqual({
      name: "TooLate",
      args: [],
      message: ESCROW_ERROR_MESSAGES_TR.TooLate,
    });
  });

  it("decodes when the caller used an ABI without the error (raw data only)", () => {
    const data = revertData("SlotAlreadyTaken", []);
    const reverted = new ContractFunctionRevertedError({ abi: [], data, functionName: "withdraw" });
    expect(reverted.data).toBeUndefined();
    expect(decodeEscrowError(new ContractFunctionExecutionError(reverted, { abi: [], functionName: "withdraw" }))?.name).toBe(
      "SlotAlreadyTaken",
    );
  });

  it("decodes RawContractError and JSON-RPC shaped errors nested in causes", () => {
    const data = revertData("NothingToWithdraw", []);
    const wrapped = new BaseError("estimate failed", { cause: new RawContractError({ data }) });
    expect(decodeEscrowError(wrapped)?.name).toBe("NothingToWithdraw");
    expect(decodeEscrowError({ code: 3, message: "execution reverted", data })?.name).toBe("NothingToWithdraw");
    expect(decodeEscrowError({ error: { data: { data } } })?.name).toBe("NothingToWithdraw");
  });

  it("returns null for non-escrow errors", () => {
    expect(decodeEscrowError(new Error("User rejected the request."))).toBeNull();
    expect(decodeEscrowError(null)).toBeNull();
    expect(decodeEscrowError("0x")).toBeNull();
    expect(decodeEscrowError("0xdeadbeef")).toBeNull();
    // Error(string)
    expect(decodeEscrowError("0x08c379a0" + encodeAbiParameters([{ type: "string" }], ["boom"]).slice(2))).toBeNull();
  });
});

describe("on-chain status", () => {
  it("mirrors the Solidity enum order", () => {
    expect(OnchainStatus).toEqual({ None: 0, Reserved: 1, Active: 2, Settled: 3, Cancelled: 4, Expired: 5 });
    expect(onchainStatusName(4)).toBe("Cancelled");
    expect(onchainStatusName(6)).toBeUndefined();
  });

  it.each([
    [OnchainStatus.None, null],
    [OnchainStatus.Reserved, "CONFIRMED"],
    [OnchainStatus.Active, "ACTIVE"],
    [OnchainStatus.Settled, "SETTLED"],
    [OnchainStatus.Cancelled, "CANCELLED"],
    [OnchainStatus.Expired, "EXPIRED"],
    [7, null],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(onchainStatusToReservationStatus(status)).toBe(expected);
  });
});

const RES_ID = toOnchainReservationId("7f0b9a52-8f5e-4d6e-9d0c-0c1e2f3a4b5c") as Hex;
const SLOT_REF = `0x${"22".repeat(32)}` as Hex;
const DRIVER: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HOST: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function createdLog(address: Address, reservationId: Hex, logIndex = 0): Log {
  const topics = encodeEventTopics({
    abi: chargeMeshEscrowAbi,
    eventName: "ReservationCreated",
    args: { reservationId, slotRef: SLOT_REF, driver: DRIVER },
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint32" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "uint64" },
      { type: "uint64" },
    ],
    [HOST, 20000, 10n ** 16n, 2n * 10n ** 17n, 1_800_000_000n, 1_800_003_600n],
  );
  return {
    address,
    topics: topics as [Hex, ...Hex[]],
    data,
    blockHash: `0x${"aa".repeat(32)}`,
    blockNumber: 100n,
    logIndex,
    transactionHash: `0x${"bb".repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  };
}

describe("escrow events", () => {
  it("finds ReservationCreated from the escrow", () => {
    const receipt = { status: "success", logs: [createdLog(ESCROW.toLowerCase() as Address, RES_ID)] };
    const found = findReservationCreated(receipt, RES_ID, ESCROW);
    expect(found?.eventName).toBe("ReservationCreated");
    expect(found?.args).toMatchObject({
      reservationId: RES_ID,
      slotRef: SLOT_REF,
      driver: DRIVER,
      host: HOST,
      requestedWh: 20000,
      depositWei: 2n * 10n ** 17n,
      startTime: 1_800_000_000n,
    });
  });

  it("ignores logs from another address, other reservations and reverted receipts", () => {
    expect(findReservationCreated({ logs: [createdLog(OTHER, RES_ID)] }, RES_ID, ESCROW)).toBeNull();
    const otherId = `0x${"33".repeat(32)}` as Hex;
    expect(findReservationCreated({ logs: [createdLog(ESCROW, otherId)] }, RES_ID, ESCROW)).toBeNull();
    expect(
      findReservationCreated({ status: "reverted", logs: [createdLog(ESCROW, RES_ID)] }, RES_ID, ESCROW),
    ).toBeNull();
  });

  it("parseEscrowEvents skips unrelated logs and filters by address", () => {
    const junk: Log = { ...createdLog(ESCROW, RES_ID, 1), topics: [`0x${"cc".repeat(32)}`], data: "0x" };
    const logs = [createdLog(ESCROW, RES_ID), junk, createdLog(OTHER, RES_ID, 2)];
    expect(parseEscrowEvents(logs)).toHaveLength(2);
    expect(parseEscrowEvents(logs, { escrow: ESCROW })).toHaveLength(1);
  });
});

describe("receipt status", () => {
  it("accepts raw RPC status 0x1 and rejects 0x0", () => {
    const logs = [createdLog(ESCROW, RES_ID)];
    expect(findReservationCreated({ status: "0x1", logs }, RES_ID, ESCROW)?.eventName).toBe("ReservationCreated");
    expect(findReservationCreated({ status: "0x0", logs }, RES_ID, ESCROW)).toBeNull();
    expect(findReservationCreated({ status: "weird", logs }, RES_ID, ESCROW)).toBeNull();
  });
});

// ---------- chunked eth_getLogs ----------

function settledLog(address: Address, reservationId: Hex, blockNumber: bigint, logIndex: number): Log {
  const topics = encodeEventTopics({
    abi: chargeMeshEscrowAbi,
    eventName: "ReservationSettled",
    args: { reservationId },
  });
  const data = encodeAbiParameters(
    [{ type: "uint32" }, { type: "uint32" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes32" }],
    [20000, 20000, 2n * 10n ** 17n, 0n, `0x${"44".repeat(32)}`],
  );
  return { ...createdLog(address, reservationId, logIndex), topics: topics as [Hex, ...Hex[]], data, blockNumber };
}

const toHex = (n: bigint | number) => `0x${n.toString(16)}` as Hex;
function toRpcLog(l: Log): RpcLog {
  return {
    ...l,
    blockNumber: toHex(l.blockNumber!),
    logIndex: toHex(l.logIndex!),
    transactionIndex: toHex(l.transactionIndex!),
  } as RpcLog;
}

type GetLogsFilter = { address?: string; topics?: unknown[]; fromBlock: Hex; toBlock: Hex };

/** Fake node: filters its log pool like eth_getLogs and records every requested range. */
function stubLogsClient(pool: Log[], opts: { latest?: bigint; failFirst?: unknown } = {}) {
  const ranges: [bigint, bigint][] = [];
  let failures = opts.failFirst ? 1 : 0;
  const same = (a: string | undefined, b: string | undefined) => a?.toLowerCase() === b?.toLowerCase();
  const matchTopic = (want: unknown, got: Hex | undefined) =>
    want === null ||
    want === undefined ||
    (Array.isArray(want) ? want.some((w: string) => same(w, got)) : same(want as string, got));
  const client = {
    request: vi.fn(async ({ method, params }: { method: string; params: [GetLogsFilter] }) => {
      if (method !== "eth_getLogs") throw new Error(`unexpected ${method}`);
      if (failures > 0) {
        failures--;
        throw opts.failFirst;
      }
      const f = params[0];
      const from = BigInt(f.fromBlock);
      const to = BigInt(f.toBlock);
      ranges.push([from, to]);
      const topics = f.topics ?? [];
      return pool
        .filter((l) => l.blockNumber! >= from && l.blockNumber! <= to)
        .filter((l) => !f.address || same(l.address, f.address))
        .filter((l) => topics.every((t, i) => matchTopic(t, l.topics[i])))
        .map(toRpcLog);
    }),
    getBlockNumber: vi.fn(async () => opts.latest ?? 0n),
    getBlock: vi.fn(async (_args: { blockTag?: string }) => ({ number: opts.latest ?? 0n })),
  };
  return { client, ranges };
}

function expectContiguous(ranges: [bigint, bigint][], from: bigint, to: bigint, max: bigint) {
  expect(ranges[0]?.[0]).toBe(from);
  expect(ranges.at(-1)?.[1]).toBe(to);
  for (const [i, [a, b]] of ranges.entries()) {
    expect(b >= a).toBe(true);
    expect(b - a + 1n <= max).toBe(true);
    if (i > 0) expect(a).toBe(ranges[i - 1]![1] + 1n);
  }
}

describe("fetchLogsChunked", () => {
  it("covers the range in <=100-block chunks without gaps or overlaps", async () => {
    const { client, ranges } = stubLogsClient([]);
    const progress: bigint[] = [];
    await fetchLogsChunked(client as never, {
      fromBlock: 1_000n,
      toBlock: 1_345n,
      onProgress: (p) => progress.push(p.scannedBlocks),
    });
    expect(ranges).toHaveLength(4);
    expectContiguous(ranges, 1_000n, 1_345n, 100n);
    expect(progress).toEqual([100n, 200n, 300n, 346n]);
  });

  it("honours a custom maxBlockRange, single-block ranges and empty ranges", async () => {
    const a = stubLogsClient([]);
    await fetchLogsChunked(a.client as never, { fromBlock: 0n, toBlock: 24n, maxBlockRange: 10 });
    expectContiguous(a.ranges, 0n, 24n, 10n);
    expect(a.ranges).toHaveLength(3);
    const b = stubLogsClient([]);
    await fetchLogsChunked(b.client as never, { fromBlock: 7n, toBlock: 7n });
    expect(b.ranges).toEqual([[7n, 7n]]);
    const c = stubLogsClient([]);
    expect(await fetchLogsChunked(c.client as never, { fromBlock: 8n, toBlock: 7n })).toEqual([]);
    expect(c.ranges).toHaveLength(0);
  });

  it("retries transient errors and rethrows others", async () => {
    const transient = Object.assign(new Error("rate limited"), { name: "HttpRequestError", status: 429 });
    const ok = stubLogsClient([], { failFirst: transient });
    await fetchLogsChunked(ok.client as never, { fromBlock: 0n, toBlock: 10n, retryDelayMs: 0 });
    expect(ok.ranges).toEqual([[0n, 10n]]);
    expect(ok.client.request).toHaveBeenCalledTimes(2);

    const fatal = new Error("invalid params");
    const bad = stubLogsClient([], { failFirst: fatal });
    await expect(
      fetchLogsChunked(bad.client as never, { fromBlock: 0n, toBlock: 10n, retryDelayMs: 0 }),
    ).rejects.toBe(fatal);
    expect(isTransientRpcError(new Error("x", { cause: { code: -32005 } }))).toBe(true);
    expect(isTransientRpcError(fatal)).toBe(false);
  });
});

describe("getEscrowEventsForReservation", () => {
  const deployBlock = TESTNET.deployBlock;
  const otherId = `0x${"33".repeat(32)}` as Hex;
  const pool: Log[] = [
    settledLog(ESCROW, RES_ID, deployBlock + 250n, 0),
    { ...createdLog(ESCROW, RES_ID, 3), blockNumber: deployBlock + 5n },
    { ...createdLog(ESCROW, otherId, 4), blockNumber: deployBlock + 6n },
    { ...createdLog(OTHER, RES_ID, 5), blockNumber: deployBlock + 7n },
  ];

  it("scans deployBlock..latest in chunks, one topic-filtered call per chunk, sorted", async () => {
    const latest = deployBlock + 299n;
    const { client, ranges } = stubLogsClient(pool, { latest });
    const events = await getEscrowEventsForReservation(client as never, { escrow: ESCROW, reservationId: RES_ID });
    expect(events.map((e) => e.eventName)).toEqual(["ReservationCreated", "ReservationSettled"]);
    expect(client.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(ranges).toHaveLength(3);
    expectContiguous(ranges, deployBlock, latest, 100n);
    const filter = client.request.mock.calls[0]![0].params[0];
    expect(filter.address).toBe(ESCROW);
    expect(filter.topics).toEqual([[...RESERVATION_EVENT_TOPICS], RES_ID]);
    expect(RESERVATION_EVENT_TOPICS).toHaveLength(5);
  });

  it("uses explicit fromBlock/toBlock and requires fromBlock for unknown escrows", async () => {
    const { client, ranges } = stubLogsClient(pool);
    await getEscrowEventsForReservation(client as never, {
      escrow: OTHER,
      reservationId: RES_ID,
      fromBlock: 10n,
      toBlock: 150n,
      maxBlockRange: 50,
    });
    expectContiguous(ranges, 10n, 150n, 50n);
    expect(client.getBlockNumber).not.toHaveBeenCalled();
    expect(escrowDeployBlock(OTHER)).toBeNull();
    await expect(
      getEscrowEventsForReservation(client as never, { escrow: OTHER, reservationId: RES_ID }),
    ).rejects.toThrow(/fromBlock/);
  });

  it("resolves a toBlock tag once", async () => {
    const { client, ranges } = stubLogsClient(pool, { latest: deployBlock + 10n });
    await getEscrowEventsForReservation(client as never, {
      escrow: ESCROW,
      reservationId: RES_ID,
      toBlock: "finalized",
    });
    expect(client.getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
    expect(ranges).toEqual([[deployBlock, deployBlock + 10n]]);
  });
});

// ---------- finality ----------

describe("waitForFinalized", () => {
  const TX = `0x${"bb".repeat(32)}` as Hex;
  const HASH_A = `0x${"aa".repeat(32)}` as Hex;
  const HASH_B = `0x${"cc".repeat(32)}` as Hex;
  type R = { blockNumber: bigint; blockHash: Hex } | null;

  /** Each call consumes the next scripted value; the last one repeats. */
  const script = <T,>(values: T[]) => {
    const queue = [...values];
    return () => (queue.length > 1 ? queue.shift()! : queue[0]!);
  };

  function stubChain(opts: { finalized: bigint[]; receipts: R[]; blockHashes?: Hex[] }) {
    const nextFinalized = script(opts.finalized);
    const nextReceipt = script(opts.receipts);
    const nextBlockHash = script(opts.blockHashes ?? [HASH_A]);
    return {
      getBlock: vi.fn(async (args: { blockTag?: string; blockNumber?: bigint }) =>
        args.blockTag === "finalized"
          ? { number: nextFinalized() }
          : { number: args.blockNumber, hash: nextBlockHash() },
      ),
      getTransactionReceipt: vi.fn(async () => {
        const r = nextReceipt();
        if (!r) throw Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
        return { ...r, status: "success", transactionHash: TX };
      }),
    };
  }

  it("polls until the finalized head reaches the receipt block and returns the receipt", async () => {
    const client = stubChain({
      finalized: [98n, 99n, 100n],
      receipts: [null, { blockNumber: 100n, blockHash: HASH_A }],
    });
    const receipt = await waitForFinalized(client as never, { hash: TX, pollMs: 1 });
    expect(receipt.blockHash).toBe(HASH_A);
    expect(client.getBlock).toHaveBeenCalledTimes(3);
    expect(client.getTransactionReceipt).toHaveBeenCalledTimes(3); // not found, found, re-check
  });

  it("throws ReorgDetectedError when the receipt moved to another block", async () => {
    const client = stubChain({
      finalized: [100n],
      receipts: [
        { blockNumber: 100n, blockHash: HASH_A },
        { blockNumber: 100n, blockHash: HASH_B },
      ],
    });
    const err = await waitForFinalized(client as never, { hash: TX, pollMs: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReorgDetectedError);
    expect((err as ReorgDetectedError).actualBlockHash).toBe(HASH_B);
  });

  it("throws ReorgDetectedError when the tx disappeared", async () => {
    const client = stubChain({ finalized: [100n], receipts: [{ blockNumber: 100n, blockHash: HASH_A }, null] });
    await expect(waitForFinalized(client as never, { hash: TX, pollMs: 1 })).rejects.toBeInstanceOf(
      ReorgDetectedError,
    );
  });

  it("supports blockNumber, detects a replaced block and times out", async () => {
    const ok = stubChain({ finalized: [5n, 7n], receipts: [null] });
    const block = await waitForFinalized(ok as never, { blockNumber: 6n, pollMs: 1 });
    expect(block.hash).toBe(HASH_A);

    const reorged = stubChain({ finalized: [7n], receipts: [null], blockHashes: [HASH_A, HASH_B] });
    await expect(waitForFinalized(reorged as never, { blockNumber: 6n, pollMs: 1 })).rejects.toBeInstanceOf(
      ReorgDetectedError,
    );

    const slow = stubChain({ finalized: [1n], receipts: [null] });
    await expect(
      waitForFinalized(slow as never, { blockNumber: 6n, pollMs: 5, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(FinalityTimeoutError);
  });
});
