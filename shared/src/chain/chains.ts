import { defineChain } from "viem";

/** Monad testnet (docs/02-mimari.md, verified 2026-09). */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://testnet-rpc.monad.xyz"],
      webSocket: ["wss://testnet-rpc.monad.xyz"],
    },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
  testnet: true,
});

/** Local Anvil (runs in WSL). */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
  testnet: true,
});

export const supportedChains = [monadTestnet, anvilLocal] as const;

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  return chainId === monadTestnet.id
    ? `${monadTestnet.blockExplorers.default.url}/tx/${txHash}`
    : null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  return chainId === monadTestnet.id
    ? `${monadTestnet.blockExplorers.default.url}/address/${address}`
    : null;
}
