import { describe, expect, it } from "vitest";
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
} from "viem";
import {
  chargeMeshEscrowAbi,
  decodeEscrowError,
  ESCROW_ERROR_MESSAGES_TR,
  findReservationCreated,
  getEscrowEventsForReservation,
  OnchainStatus,
  onchainStatusName,
  onchainStatusToReservationStatus,
  parseEscrowEvents,
  toOnchainReservationId,
  type EscrowErrorName,
} from "./index";

const ESCROW: Address = "0x978b36423D76F24D3066e7B46bb84d38821C13F3";
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

  it("getEscrowEventsForReservation queries each event from deployBlock and sorts", async () => {
    const calls: { eventName?: string; fromBlock?: unknown; args?: unknown }[] = [];
    const client = {
      getContractEvents: async (p: { eventName?: string; fromBlock?: unknown; args?: unknown }) => {
        calls.push(p);
        if (p.eventName === "ReservationCreated") return parseEscrowEvents([createdLog(ESCROW, RES_ID, 5)]);
        return [];
      },
    };
    const events = await getEscrowEventsForReservation(client as never, { escrow: ESCROW, reservationId: RES_ID });
    expect(events.map((e) => e.eventName)).toEqual(["ReservationCreated"]);
    expect(calls).toHaveLength(5);
    expect(calls.every((c) => c.fromBlock === 65831173n)).toBe(true);
    expect(calls[0]?.args).toEqual({ reservationId: RES_ID });
  });
});
