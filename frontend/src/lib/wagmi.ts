import { anvilLocal, monadTestnet } from "@chargemesh/shared";
import { createConfig, http } from "@wagmi/vue";
import { injected } from "@wagmi/vue/connectors";

export const metaMaskConnector = injected({
  target: "metaMask",
  shimDisconnect: true,
  unstable_shimAsyncInject: 2_000,
});

export const wagmiConfig = createConfig({
  chains: [monadTestnet, anvilLocal],
  // The demo intentionally targets MetaMask. WalletConnect and other wallets are out of scope.
  connectors: [metaMaskConnector],
  transports: {
    [monadTestnet.id]: http(),
    [anvilLocal.id]: http(),
  },
  ssr: false,
});

declare module "@wagmi/vue" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
