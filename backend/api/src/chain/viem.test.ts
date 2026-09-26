import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Viem from "viem";
import type * as Shared from "@chargemesh/shared";

const mocks = vi.hoisted(() => ({
  publicClient: {
    estimateContractGas: vi.fn(),
    getBytecode: vi.fn(),
    getChainId: vi.fn(),
    getTransactionCount: vi.fn(),
    readContract: vi.fn(),
    simulateContract: vi.fn(),
  },
  walletClient: { writeContract: vi.fn() },
  waitForFinalized: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return {
    ...actual,
    createPublicClient: () => mocks.publicClient,
    createWalletClient: () => mocks.walletClient,
  };
});

vi.mock("@chargemesh/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof Shared>();
  return {
    ...actual,
    getDeployment: () => ({ escrow: "0x692Ee24f6CCeB942d2482e8c7405A8C46843DB98" }),
    waitForFinalized: mocks.waitForFinalized,
  };
});

import { createViemChainGateway } from "./viem";

const KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const HASH = `0x${"ab".repeat(32)}` as `0x${string}`;
const RESERVATION = `0x${"cd".repeat(32)}` as `0x${string}`;

describe("ViemChainGateway transaction safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.publicClient.getTransactionCount.mockResolvedValue(7);
    mocks.publicClient.getChainId.mockResolvedValue(10143);
    mocks.publicClient.getBytecode.mockResolvedValue("0x6000");
    mocks.publicClient.readContract.mockResolvedValue("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A");
    mocks.publicClient.estimateContractGas.mockResolvedValue(100_001n);
    mocks.publicClient.simulateContract.mockResolvedValue({ request: { to: "0x0000000000000000000000000000000000000001" } });
    mocks.walletClient.writeContract.mockResolvedValue(HASH);
    mocks.waitForFinalized.mockResolvedValue({
      status: "success",
      logs: [],
      blockNumber: 10n,
      to: "0x692Ee24f6CCeB942d2482e8c7405A8C46843DB98",
    });
  });

  it("uses estimated gas plus ten percent and serializes concurrent settler nonces", async () => {
    const gateway = createViemChainGateway({
      mode: "monad",
      chainId: 10143,
      rpcUrl: "http://localhost:8545",
      settlerPrivateKey: KEY,
    });

    await Promise.all([gateway.startSession(RESERVATION), gateway.startSession(RESERVATION)]);

    expect(mocks.publicClient.getTransactionCount).toHaveBeenCalledTimes(1);
    expect(mocks.walletClient.writeContract.mock.calls.map(([request]) => request.nonce)).toEqual([7, 8]);
    expect(mocks.walletClient.writeContract.mock.calls.map(([request]) => request.gas)).toEqual([110_002n, 110_002n]);
  });

  it("verifies a reserve transaction only after shared finality confirms its receipt", async () => {
    const gateway = createViemChainGateway({
      mode: "monad",
      chainId: 10143,
      rpcUrl: "http://localhost:8545",
      settlerPrivateKey: KEY,
    });
    const result = await gateway.verifyReserveTx(HASH, RESERVATION);
    expect(mocks.waitForFinalized).toHaveBeenCalledWith(expect.anything(), { hash: HASH, timeoutMs: 60_000 });
    expect(result).toMatchObject({ ok: false });
  });

  it("checks the RPC chain, deployed bytecode and on-chain settler before startup", async () => {
    const gateway = createViemChainGateway({
      mode: "monad",
      chainId: 10143,
      rpcUrl: "http://localhost:8545",
      settlerPrivateKey: KEY,
    });

    await expect(gateway.assertReady()).resolves.toBeUndefined();
    expect(mocks.publicClient.getChainId).toHaveBeenCalledOnce();
    expect(mocks.publicClient.getBytecode).toHaveBeenCalledWith({
      address: "0x692Ee24f6CCeB942d2482e8c7405A8C46843DB98",
    });
    expect(mocks.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "settler" }),
    );
  });
});
