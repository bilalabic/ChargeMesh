"use client";

import { useConnection } from "wagmi";

/** Connected wallet for the current user; `address` is undefined when disconnected. */
export function useWallet() {
  const { address, chainId, isConnected, status } = useConnection();
  return { address, chainId, isConnected, status };
}
