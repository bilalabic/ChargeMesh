/** Driver intent routes (docs/03-api.md, "Driver"). Business logic lands in M1. */
import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

export function intentRoutes(_deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    // TODO(M1): docs/03-api.md "Driver" - POST /intents (CreateIntentRequest -> 201 ChargeIntent).
    app.post("/intents", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Driver" - GET /intents/:intentId -> ChargeIntent.
    app.get("/intents/:intentId", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Driver" + matching section - GET /intents/:intentId/matches
    // -> MatchesResponse via rankMatches from @chargemesh/shared.
    app.get("/intents/:intentId/matches", async (_req, reply) => notImplemented(reply));
  };
}
