import { useAccount } from "@wagmi/vue";

/** Connected wallet for the current user; `address` is undefined when disconnected. */
export function useWallet() {
  const { address, chainId, isConnected, status } = useAccount();
  return { address, chainId, isConnected, status };
}
