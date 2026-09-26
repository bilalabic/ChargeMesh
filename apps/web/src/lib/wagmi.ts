import { anvilLocal, monadTestnet } from "@chargemesh/shared";
import { createConfig, http, injected } from "wagmi";

export const wagmiConfig = createConfig({
  chains: [monadTestnet, anvilLocal],
  // MetaMask, Rabby and other injected wallets only (WalletConnect is out of scope).
  connectors: [injected()],
  transports: {
    [monadTestnet.id]: http(),
    [anvilLocal.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
