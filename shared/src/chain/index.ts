export * from "./abi";
export * from "./chains";
export * from "./deployments";
export * from "./eip712";
export * from "./types";

import { deployments } from "./deployments";
import type { Deployment } from "./types";

export function getDeployment(chainId: number): Deployment | null {
  return deployments[chainId] ?? null;
}
