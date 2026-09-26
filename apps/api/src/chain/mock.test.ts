import {
  buildQuoteTypedData,
  depositFor,
  toOnchainReservationId,
  toSlotRef,
  type ReservationQuote,
} from "@chargemesh/shared";
import { recoverTypedDataAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { createMockChainGateway, mockTxHash } from "./mock";

const reservationUuid = "6f1c2a9b-0d4e-4f81-a2b3-c4d5e6f70812";
const onchainId = toOnchainReservationId(reservationUuid);
const price = "10000000000000000";

const quote: ReservationQuote = {
  reservationId: onchainId,
  slotRef: toSlotRef("0b7c0e1a-2d3f-4a5b-8c9d-0e1f2a3b4c5d"),
  driver: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  host: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  requestedWh: 20_000,
  pricePerKwhWei: price,
  depositWei: depositFor(20_000, price).toString(),
  startTime: 1_791_010_800,
  endTime: 1_791_025_200,
  quoteExpiry: 1_791_003_300,
};

describe("MockChainGateway", () => {
  it("signQuote produces an EIP-712 signature recoverable to settlerAddress", async () => {
    const gw = createMockChainGateway({ chainId: 31337 });
    const signature = await gw.signQuote(quote);
    const recovered = await recoverTypedDataAddress({
      ...buildQuoteTypedData(quote, gw.chainId, gw.contractAddress),
      signature,
    });
    expect(recovered).toBe(gw.settlerAddress);
  });

  it("uses a configured key deterministically", async () => {
    // Well-known Anvil test key #0 (public, never funded outside local chains).
    const key: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const gw = createMockChainGateway({ chainId: 31337, settlerPrivateKey: key });
    expect(gw.settlerAddress).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("follows the contract state machine with deterministic tx hashes", async () => {
    const gw = createMockChainGateway({ chainId: 31337 });
    await gw.signQuote(quote);
    expect(await gw.readReservation(onchainId)).toBeNull();

    const reserveTx = mockTxHash("reserve", onchainId);
    expect(await gw.verifyReserveTx(reserveTx, onchainId)).toEqual({
      ok: true,
      txHash: reserveTx,
      blockNumber: null,
    });
    expect((await gw.readReservation(onchainId))?.status).toBe("Reserved");

    const startTx = await gw.startSession(onchainId);
    expect(startTx).toBe(mockTxHash("startSession", onchainId));
    await expect(gw.startSession(onchainId)).rejects.toThrow(/InvalidStatus/);

    const sessionHash = `0x${"ab".repeat(32)}` as Hex;
    const settled = await gw.settle(onchainId, 14_500, sessionHash);
    expect(settled.billableWh).toBe(14_500);
    expect(settled.hostAmountWei).toBe(145_000_000_000_000_000n);
    expect(settled.refundWei).toBe(55_000_000_000_000_000n);
    expect((await gw.readReservation(onchainId))?.status).toBe("Settled");
  });
});
