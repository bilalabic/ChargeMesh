/** Demo routes (docs/03-api.md, "Sistem"). Business logic lands in M1. */
import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

export function demoRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    // Only when NODE_ENV !== "production" (docs/03-api.md).
    if (deps.config.nodeEnv === "production") return;
    // TODO(M1): docs/03-api.md "Sistem" - POST /demo/seed (idempotent) -> DemoSeedResponse.
    app.post("/demo/seed", async (_req, reply) => notImplemented(reply));
  };
}
