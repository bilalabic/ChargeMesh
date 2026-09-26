/** Charging session routes (docs/03-api.md, "Oturum"). Business logic lands in M1. */
import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

export function sessionRoutes(_deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    // TODO(M1): docs/03-api.md "Oturum" (start checks) - OcppCentralSystem.remoteStart with
    // toOcppIdTag(reservation.id) -> 201 ChargingSession (STARTING).
    app.post("/sessions/start", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Oturum" - GET /sessions/:id -> ChargingSession.
    app.get("/sessions/:id", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Oturum" - POST /sessions/:id/stop -> OcppCentralSystem.remoteStop.
    app.post("/sessions/:id/stop", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "SSE" - text/event-stream fed by SessionEventBus, wallet via
    // ?wallet=, initial session.updated, ": ping" comment every 15 s.
    app.get("/sessions/:id/events", async (_req, reply) => notImplemented(reply));
  };
}
