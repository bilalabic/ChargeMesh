import { describe, expect, it } from "vitest";
import { wagmiConfig } from "./wagmi";
import { walletConnectionErrorMessage } from "./wallet";

describe("walletConnectionErrorMessage", () => {
  it("explains when MetaMask is missing", () => {
    const error = Object.assign(new Error("provider not found"), { name: "ProviderNotFoundError" });
    expect(walletConnectionErrorMessage(error)).toContain("MetaMask bulunamadı");
  });

  it("explains rejected and already-pending requests", () => {
    expect(walletConnectionErrorMessage(new Error("User rejected request (4001)"))).toContain(
      "isteği iptal edildi",
    );
    expect(walletConnectionErrorMessage(new Error("request already pending (-32002)"))).toContain(
      "bekleyen bir istek",
    );
  });
});

describe("MetaMask wagmi configuration", () => {
  it("targets MetaMask and exposes Monad testnet plus local Anvil", () => {
    expect(wagmiConfig.connectors.map((connector) => connector.id)).toEqual(["metaMask"]);
    expect(wagmiConfig.chains.map((chain) => chain.id)).toEqual([10143, 31337]);
  });
});
