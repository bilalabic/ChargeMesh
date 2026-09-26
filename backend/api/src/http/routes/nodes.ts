/** Host node routes (docs/03-api.md, "Host"). Business logic lands in M1. */
import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

export function nodeRoutes(_deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    // TODO(M1): docs/03-api.md "Host" - POST /nodes (CreateNodeRequest -> 201 ChargingNode).
    app.post("/nodes", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Host" - GET /nodes?mine=true -> ChargingNode[] (own nodes, full view).
    app.get("/nodes", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Host" - GET /nodes/:nodeId -> ChargingNode (owner) or PublicChargingNode.
    app.get("/nodes/:nodeId", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Host" - POST /nodes/:nodeId/slots (CreateSlotRequest -> 201 EnergySlot).
    app.post("/nodes/:nodeId/slots", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Host" - GET /nodes/:nodeId/slots -> EnergySlot[] by startsAt asc.
    app.get("/nodes/:nodeId/slots", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Host" - GET /nodes/:nodeId/reservations -> Reservation[] (access = null).
    app.get("/nodes/:nodeId/reservations", async (_req, reply) => notImplemented(reply));
  };
}
