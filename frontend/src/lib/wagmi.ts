import { anvilLocal, monadTestnet } from "@chargemesh/shared";
import { createConfig, http } from "@wagmi/vue";
import { injected } from "@wagmi/vue/connectors";

export const wagmiConfig = createConfig({
  chains: [monadTestnet, anvilLocal],
  // MetaMask, Rabby and other injected wallets only (WalletConnect is out of scope).
  connectors: [injected()],
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
