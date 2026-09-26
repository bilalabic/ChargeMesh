/**
 * CHAIN_MODE=mock: no network. Signatures are real (viem, local key) so the web can
 * verify them; tx hashes are deterministic fakes; state is kept in memory and follows
 * the contract state machine (None -> Reserved -> Active -> Settled) as far as it knows.
 */
import {
  buildQuoteTypedData,
  computeSettlement,
  getDeployment,
  type ReservationQuote,
} from "@chargemesh/shared";
import { DEMO_CONTRACT_ADDRESS } from "@chargemesh/shared/fixtures";
import { keccak256, stringToBytes, zeroHash, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ChainGateway, OnchainReservation, SettleResult } from "./types";

export interface MockChainGatewayOptions {
  chainId: number;
  /** When omitted an ephemeral key is generated (signatures stay valid for this process). */
  settlerPrivateKey?: Hex;
  contractAddress?: Address;
}

/** Deterministic fake tx hash for an action on a reservation. */
export function mockTxHash(action: string, onchainId: Hex): Hex {
  return keccak256(stringToBytes(`chargemesh:mock-tx:${action}:${onchainId.toLowerCase()}`));
}

export class MockChainGateway implements ChainGateway {
  readonly mode = "mock" as const;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly settlerAddress: Address;

  private readonly account: ReturnType<typeof privateKeyToAccount>;
  private readonly reservations = new Map<string, OnchainReservation>();

  constructor(opts: MockChainGatewayOptions) {
    this.chainId = opts.chainId;
    this.account = privateKeyToAccount(opts.settlerPrivateKey ?? generatePrivateKey());
    this.settlerAddress = this.account.address;
    this.contractAddress =
      opts.contractAddress ??
      getDeployment(opts.chainId)?.escrow ??
      (DEMO_CONTRACT_ADDRESS as Address);
  }

  async signQuote(quote: ReservationQuote): Promise<Hex> {
    const signature = await this.account.signTypedData(
      buildQuoteTypedData(quote, this.chainId, this.contractAddress),
    );
    // Remember the quote so later calls can mimic the contract's bookkeeping.
    const key = quote.reservationId.toLowerCase();
    if (!this.reservations.has(key)) {
      this.reservations.set(key, {
        reservationId: quote.reservationId as Hex,
        slotRef: quote.slotRef as Hex,
        driver: quote.driver as Address,
        host: quote.host as Address,
        requestedWh: quote.requestedWh,
        deliveredWh: 0,
        pricePerKwhWei: BigInt(quote.pricePerKwhWei),
        depositWei: BigInt(quote.depositWei),
        startTime: BigInt(quote.startTime),
        endTime: BigInt(quote.endTime),
        status: "None",
        sessionHash: zeroHash,
      });
    }
    return signature;
  }

  /** Mock mode accepts every well-formed hash (docs/02-mimari.md, "Çalışma modları"). */
  async verifyReserveTx(txHash: Hex, onchainId: Hex): Promise<{ ok: true; txHash: Hex; blockNumber: null }> {
    const r = this.reservations.get(onchainId.toLowerCase());
    if (r && r.status === "None") r.status = "Reserved";
    return { ok: true, txHash, blockNumber: null };
  }

  async startSession(onchainId: Hex): Promise<Hex> {
    const r = this.reservations.get(onchainId.toLowerCase());
    if (r) {
      if (r.status !== "Reserved") throw new Error(`mock startSession: InvalidStatus(${r.status})`);
      r.status = "Active";
    }
    return mockTxHash("startSession", onchainId);
  }

  async settle(onchainId: Hex, deliveredWh: number, sessionHash: Hex): Promise<SettleResult> {
    if (sessionHash === zeroHash) throw new Error("mock settle: ZeroSessionHash");
    const txHash = mockTxHash("settle", onchainId);
    const r = this.reservations.get(onchainId.toLowerCase());
    if (!r) {
      // Unknown to this process (e.g. restarted): amounts cannot be derived here.
      return { txHash, deliveredWh, billableWh: deliveredWh, hostAmountWei: 0n, refundWei: 0n, sessionHash };
    }
    if (r.status !== "Active") {
      throw new Error(`mock settle: InvalidStatus(${r.status})`);
    }
    const s = computeSettlement({
      requestedWh: r.requestedWh,
      deliveredWh,
      pricePerKwhWei: r.pricePerKwhWei,
      depositWei: r.depositWei,
    });
    r.status = "Settled";
    r.deliveredWh = deliveredWh;
    r.sessionHash = sessionHash;
    return {
      txHash,
      deliveredWh,
      billableWh: s.billableWh,
      hostAmountWei: s.hostAmountWei,
      refundWei: s.refundWei,
      sessionHash,
    };
  }

  async readReservation(onchainId: Hex): Promise<OnchainReservation | null> {
    const r = this.reservations.get(onchainId.toLowerCase());
    if (!r || r.status === "None") return null;
    return { ...r };
  }
}

export function createMockChainGateway(opts: MockChainGatewayOptions): MockChainGateway {
  return new MockChainGateway(opts);
}
