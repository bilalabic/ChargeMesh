/** System routes (docs/03-api.md, "Sistem"). GET /health is registered at the root in app.ts. */
import {
  AppConfig,
  ChargerStatus,
  HealthResponse,
  getDeployment,
  monadTestnet,
  routes,
} from "@chargemesh/shared";
import type { FastifyPluginAsync } from "fastify";
import type { RouteDeps } from "./deps";

export function healthPayload(deps: Pick<RouteDeps, "config">): HealthResponse {
  return HealthResponse.parse({
    status: "ok",
    chainMode: deps.config.chainMode,
    chainId: deps.config.chainId,
  });
}

export function systemRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.get(routes.config(), async () => {
      const { config, chain } = deps;
      // Deployed escrow when known; in CHAIN_MODE=mock the gateway's placeholder address.
      const contract = getDeployment(config.chainId)?.escrow ?? chain.contractAddress;
      return AppConfig.parse({
        chainId: config.chainId,
        chainMode: config.chainMode,
        contractAddress: contract.toLowerCase(),
        settlerAddress: chain.settlerAddress.toLowerCase(),
        explorerUrl:
          config.chainId === monadTestnet.id ? monadTestnet.blockExplorers.default.url : null,
        quoteTtlSeconds: config.quoteTtlSeconds,
      });
    });

    app.get(routes.chargers(), async () => ChargerStatus.array().parse(deps.chargers.list()));
  };
}
