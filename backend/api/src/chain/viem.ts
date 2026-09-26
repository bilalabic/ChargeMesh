/**
 * CHAIN_MODE=anvil|monad: talks to ChargeMeshEscrow with viem. The settler key signs
 * quotes and sends startSession()/settle(). Address comes from getDeployment(chainId).
 */
import {
  anvilLocal,
  buildQuoteTypedData,
  chargeMeshEscrowAbi,
  getDeployment,
  monadTestnet,
  type ReservationQuote,
} from "@chargemesh/shared";
import {
  WaitForTransactionReceiptTimeoutError,
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  onchainStatusFromUint8,
  type ChainGateway,
  type OnchainReservation,
  type ReserveTxVerification,
  type SettleResult,
} from "./types";

export interface ViemChainGatewayOptions {
  mode: "anvil" | "monad";
  chainId: number;
  rpcUrl: string;
  settlerPrivateKey: Hex;
  /** Receipt wait timeout for confirm/startSession/settle. */
  receiptTimeoutMs?: number;
}

export function createViemChainGateway(opts: ViemChainGatewayOptions): ChainGateway {
  const chain = opts.chainId === monadTestnet.id ? monadTestnet : anvilLocal;
  if (chain.id !== opts.chainId) {
    throw new Error(`Unsupported chainId ${opts.chainId} for CHAIN_MODE=${opts.mode}`);
  }
  const deployment = getDeployment(opts.chainId);
  if (!deployment) {
    throw new Error(
      `No ChargeMeshEscrow deployment for chainId ${opts.chainId} (shared/src/chain/deployments.ts)`,
    );
  }
  const escrow = deployment.escrow;
  const account = privateKeyToAccount(opts.settlerPrivateKey);
  const transport = http(opts.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });
  const timeout = opts.receiptTimeoutMs ?? 60_000;

  async function waitSuccess(hash: Hex, action: string): Promise<TransactionReceipt> {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout });
    if (receipt.status !== "success") throw new Error(`${action} reverted (tx ${hash})`);
    return receipt;
  }

  return {
    mode: opts.mode,
    chainId: opts.chainId,
    contractAddress: escrow,
    settlerAddress: account.address,

    async signQuote(quote: ReservationQuote): Promise<Hex> {
      return account.signTypedData(buildQuoteTypedData(quote, opts.chainId, escrow));
    },

    async verifyReserveTx(txHash: Hex, onchainId: Hex): Promise<ReserveTxVerification> {
      let receipt: TransactionReceipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout });
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) {
          return { ok: false, reason: "Transaction receipt not found" };
        }
        throw err;
      }
      if (receipt.status !== "success") return { ok: false, reason: "Transaction reverted" };
      if (!receipt.to || !isAddressEqual(receipt.to, escrow)) {
        return { ok: false, reason: "Transaction was not sent to the escrow contract" };
      }
      const created = parseEventLogs({
        abi: chargeMeshEscrowAbi,
        eventName: "ReservationCreated",
        logs: receipt.logs,
      }).find(
        (log) =>
          isAddressEqual(log.address, escrow) &&
          log.args.reservationId.toLowerCase() === onchainId.toLowerCase(),
      );
      if (!created) return { ok: false, reason: "ReservationCreated event not found for this reservation" };
      return { ok: true, txHash, blockNumber: receipt.blockNumber };
    },

    async startSession(onchainId: Hex): Promise<Hex> {
      const { request } = await publicClient.simulateContract({
        account,
        address: escrow,
        abi: chargeMeshEscrowAbi,
        functionName: "startSession",
        args: [onchainId],
      });
      const hash = await walletClient.writeContract(request);
      await waitSuccess(hash, "startSession");
      return hash;
    },

    async settle(onchainId: Hex, deliveredWh: number, sessionHash: Hex): Promise<SettleResult> {
      const { request } = await publicClient.simulateContract({
        account,
        address: escrow,
        abi: chargeMeshEscrowAbi,
        functionName: "settle",
        args: [onchainId, deliveredWh, sessionHash],
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await waitSuccess(hash, "settle");
      const settled = parseEventLogs({
        abi: chargeMeshEscrowAbi,
        eventName: "ReservationSettled",
        logs: receipt.logs,
      }).find((log) => log.args.reservationId.toLowerCase() === onchainId.toLowerCase());
      if (!settled) throw new Error(`settle: ReservationSettled event missing (tx ${hash})`);
      return {
        txHash: hash,
        deliveredWh: settled.args.deliveredWh,
        billableWh: settled.args.billableWh,
        hostAmountWei: settled.args.hostAmountWei,
        refundWei: settled.args.refundWei,
        sessionHash: settled.args.sessionHash,
      };
    },

    async readReservation(onchainId: Hex): Promise<OnchainReservation | null> {
      const r = await publicClient.readContract({
        address: escrow,
        abi: chargeMeshEscrowAbi,
        functionName: "getReservation",
        args: [onchainId],
      });
      const status = onchainStatusFromUint8(r.status);
      if (status === "None") return null;
      return {
        reservationId: onchainId,
        slotRef: r.slotRef,
        driver: r.driver as Address,
        host: r.host as Address,
        requestedWh: r.requestedWh,
        deliveredWh: r.deliveredWh,
        pricePerKwhWei: r.pricePerKwhWei,
        depositWei: r.depositWei,
        startTime: r.startTime,
        endTime: r.endTime,
        status,
        sessionHash: r.sessionHash,
      };
    },
  };
}
