import {
  chargeMeshEscrowAbi,
  decodeEscrowError,
  quoteToContractArgs,
  type ReservationQuote,
} from "@chargemesh/shared";
import { useWriteContract } from "@wagmi/vue";
import {
  estimateFeesPerGas,
  getAccount,
  getBalance,
  getPublicClient,
  simulateContract,
  switchChain,
} from "@wagmi/vue/actions";
import { parseEther, type Address, type Hex } from "viem";
import { wagmiConfig } from "../lib/wagmi";

const GAS_MARGIN_NUMERATOR = 110n;
const GAS_MARGIN_DENOMINATOR = 100n;
const MONAD_RESERVE = parseEther("10");

export function transactionErrorMessage(error: unknown) {
  const decoded = decodeEscrowError(error);
  if (decoded) return decoded.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|cancel/i.test(message)) return "İşlem cüzdanda iptal edildi.";
  return "Zincir işlemi tamamlanamadı. Cüzdanı, ağı ve bakiyeyi kontrol edip tekrar deneyin.";
}

export function useEscrowTransactions() {
  const writer = useWriteContract();

  async function prepare(chainId: 10143 | 31337, address: Address) {
    let account = getAccount(wagmiConfig);
    if (!account.address) throw new Error("İşlem için önce cüzdanınızı bağlayın.");
    if (account.chainId !== chainId) {
      await switchChain(wagmiConfig, { chainId });
      account = getAccount(wagmiConfig);
    }
    if (!account.address) throw new Error("Cüzdan bağlantısı ağ değişimi sırasında kesildi.");
    const publicClient = getPublicClient(wagmiConfig, { chainId });
    if (!publicClient) throw new Error("Seçilen ağ için RPC istemcisi hazırlanamadı.");
    return { account: account.address as Address, address, publicClient };
  }

  async function reserve(input: {
    chainId: 10143 | 31337;
    contractAddress: Address;
    quote: ReservationQuote;
    signature: Hex;
  }) {
    const prepared = await prepare(input.chainId, input.contractAddress);
    const args = [quoteToContractArgs(input.quote), input.signature] as const;
    const value = BigInt(input.quote.depositWei);
    const simulation = await simulateContract(wagmiConfig, {
      account: prepared.account,
      address: input.contractAddress,
      abi: chargeMeshEscrowAbi,
      functionName: "reserve",
      args,
      value,
      chainId: input.chainId,
    });
    const estimate = await prepared.publicClient.estimateContractGas({
      account: prepared.account,
      address: input.contractAddress,
      abi: chargeMeshEscrowAbi,
      functionName: "reserve",
      args,
      value,
    });
    const gas = (estimate * GAS_MARGIN_NUMERATOR) / GAS_MARGIN_DENOMINATOR;

    if (input.chainId === 10143) {
      const [balance, fees] = await Promise.all([
        getBalance(wagmiConfig, { address: prepared.account, chainId: input.chainId }),
        estimateFeesPerGas(wagmiConfig, { chainId: input.chainId }),
      ]);
      const feePerGas = fees.maxFeePerGas ?? fees.gasPrice;
      const remaining = balance.value - value - gas * feePerGas;
      if (remaining < MONAD_RESERVE) {
        const proceed = window.confirm(
          "Bu işlemden sonra bakiye 10 MON rezerv sınırının altına düşebilir ve işlem başarısız olabilir. Yine de devam edilsin mi?",
        );
        if (!proceed) throw new Error("İşlem bakiye uyarısından sonra iptal edildi.");
      }
    }

    return writer.writeContractAsync({ ...simulation.request, gas });
  }

  async function simpleWrite(input: {
    chainId: 10143 | 31337;
    contractAddress: Address;
    functionName: "cancel" | "expire";
    reservationId: Hex;
  }) {
    const prepared = await prepare(input.chainId, input.contractAddress);
    const simulation = await simulateContract(wagmiConfig, {
      account: prepared.account,
      address: input.contractAddress,
      abi: chargeMeshEscrowAbi,
      functionName: input.functionName,
      args: [input.reservationId],
      chainId: input.chainId,
    });
    const estimate = await prepared.publicClient.estimateContractGas({
      account: prepared.account,
      address: input.contractAddress,
      abi: chargeMeshEscrowAbi,
      functionName: input.functionName,
      args: [input.reservationId],
    });
    const gas = (estimate * GAS_MARGIN_NUMERATOR) / GAS_MARGIN_DENOMINATOR;
    return writer.writeContractAsync({ ...simulation.request, gas });
  }

  async function withdraw(input: { chainId: 10143 | 31337; contractAddress: Address }) {
    const prepared = await prepare(input.chainId, input.contractAddress);
    const simulation = await simulateContract(wagmiConfig, {
      account: prepared.account,
      address: input.contractAddress,
      abi: chargeMeshEscrowAbi,
      functionName: "withdraw",
      chainId: input.chainId,
    });
    const estimate = await prepared.publicClient.estimateContractGas({
      account: prepared.account,
      address: input.contractAddress,
      abi: chargeMeshEscrowAbi,
      functionName: "withdraw",
    });
    const gas = (estimate * GAS_MARGIN_NUMERATOR) / GAS_MARGIN_DENOMINATOR;
    return writer.writeContractAsync({ ...simulation.request, gas });
  }

  return { reserve, simpleWrite, withdraw, isPending: writer.isPending };
}
