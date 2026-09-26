/** Slot routes (docs/03-api.md, "Host"). Business logic lands in M1. */
import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

export function slotRoutes(_deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    // TODO(M1): docs/03-api.md "Host" - POST /slots/:slotId/close -> EnergySlot (only while OPEN,
    // otherwise INVALID_STATE).
    app.post("/slots/:slotId/close", async (_req, reply) => notImplemented(reply));
  };
}
