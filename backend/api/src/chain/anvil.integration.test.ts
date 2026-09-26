import { randomUUID } from "node:crypto";
import {
  anvilLocal,
  buildQuoteTypedData,
  chargeMeshEscrowAbi,
  depositFor,
  getDeployment,
  quoteToContractArgs,
  toOnchainReservationId,
  toSlotRef,
  type ReservationQuote,
} from "@chargemesh/shared";
import { createPublicClient, createWalletClient, http, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { createViemChainGateway } from "./viem";

const SETTLER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DRIVER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const HOST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const RPC_URL = anvilLocal.rpcUrls.default.http[0];
const deployment = getDeployment(anvilLocal.id);
const enabled = process.env.RUN_ANVIL_INTEGRATION === "1" && deployment !== null;

describe.skipIf(!enabled)("ViemChainGateway Anvil integration", () => {
  it.each([20_000, 14_500])("reserves, starts and settles %i Wh", async (deliveredWh) => {
    if (!deployment) throw new Error("Chain 31337 deployment is required");
    const settler = privateKeyToAccount(SETTLER_KEY);
    const driverAccount = privateKeyToAccount(DRIVER_KEY);
    const transport = http(RPC_URL);
    const publicClient = createPublicClient({ chain: anvilLocal, transport });
    const driver = createWalletClient({ chain: anvilLocal, transport, account: driverAccount });
    const gateway = createViemChainGateway({
      mode: "anvil",
      chainId: anvilLocal.id,
      rpcUrl: RPC_URL,
      settlerPrivateKey: SETTLER_KEY,
    });
    const { timestamp } = await publicClient.getBlock();
    const now = Number(timestamp);
    const quote: ReservationQuote = {
      reservationId: toOnchainReservationId(randomUUID()),
      slotRef: toSlotRef(randomUUID()),
      driver: driverAccount.address.toLowerCase(),
      host: HOST,
      requestedWh: 20_000,
      pricePerKwhWei: "10000000000000000",
      depositWei: depositFor(20_000, "10000000000000000").toString(),
      startTime: now + 60,
      endTime: now + 4 * 60 * 60,
      quoteExpiry: now + 300,
    };
    const signature = await gateway.signQuote(quote);
    expect(
      await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, anvilLocal.id, deployment.escrow),
        signature,
      }),
    ).toBe(settler.address);

    const reserveHash = await driver.writeContract({
      address: deployment.escrow,
      abi: chargeMeshEscrowAbi,
      functionName: "reserve",
      args: [quoteToContractArgs(quote), signature],
      value: BigInt(quote.depositWei),
    });
    await publicClient.waitForTransactionReceipt({ hash: reserveHash });
    expect(await gateway.verifyReserveTx(reserveHash, quote.reservationId as Hex)).toMatchObject({ ok: true });
    expect((await gateway.readReservation(quote.reservationId as Hex))?.status).toBe("Reserved");

    const startHash = await gateway.startSession(quote.reservationId as Hex);
    expect(startHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect((await gateway.readReservation(quote.reservationId as Hex))?.status).toBe("Active");

    const sessionHash = `0x${(deliveredWh === 20_000 ? "ab" : "cd").repeat(32)}` as Hex;
    const result = await gateway.settle(quote.reservationId as Hex, deliveredWh, sessionHash);
    expect(result.deliveredWh).toBe(deliveredWh);
    expect(result.sessionHash).toBe(sessionHash);
    const onchain = await gateway.readReservation(quote.reservationId as Hex);
    expect(onchain?.status).toBe("Settled");
    expect(onchain?.deliveredWh).toBe(deliveredWh);
    expect(onchain?.sessionHash).toBe(sessionHash);
  }, 30_000);
});
