/**
 * ChainGateway: the only way the API touches the chain (apps/api/AGENTS.md).
 * CHAIN_MODE=mock -> MockChainGateway (no network), anvil|monad -> ViemChainGateway.
 */
import type { AppConfigEnv } from "../config";
import { createMockChainGateway } from "./mock";
import type { ChainGateway } from "./types";
import { createViemChainGateway } from "./viem";

export * from "./types";
export { MockChainGateway, createMockChainGateway, mockTxHash } from "./mock";
export { createViemChainGateway } from "./viem";

export function createChainGateway(config: AppConfigEnv): ChainGateway {
  if (config.chainMode === "mock") {
    return createMockChainGateway({
      chainId: config.chainId,
      settlerPrivateKey: config.settlerPrivateKey ?? undefined,
    });
  }
  if (!config.settlerPrivateKey) {
    throw new Error(`SETTLER_PRIVATE_KEY is required when CHAIN_MODE=${config.chainMode}`);
  }
  if (!config.rpcUrl) {
    throw new Error(`RPC_URL is required when CHAIN_MODE=${config.chainMode}`);
  }
  return createViemChainGateway({
    mode: config.chainMode,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    settlerPrivateKey: config.settlerPrivateKey,
  });
}
