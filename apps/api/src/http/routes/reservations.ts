/** Reservation routes (docs/03-api.md, "Driver" and "Proof of Charge"). Business logic lands in M1. */
import type { FastifyPluginAsync } from "fastify";
import { notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

export function reservationRoutes(_deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    // TODO(M1): docs/03-api.md "Driver" (POST /reservations behaviour) - single DB transaction,
    // SELECT ... FOR UPDATE on the slot, quote + ChainGateway.signQuote -> 201 CreateReservationResponse.
    app.post("/reservations", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Driver" (confirm behaviour) - ChainGateway.verifyReserveTx, idempotent.
    app.post("/reservations/:id/confirm", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Driver" - POST /reservations/:id/sync -> ChainGateway.readReservation.
    app.post("/reservations/:id/sync", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Driver" - GET /reservations?role=driver|host -> Reservation[] newest first.
    app.get("/reservations", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Driver" - GET /reservations/:id -> Reservation (driver or host).
    app.get("/reservations/:id", async (_req, reply) => notImplemented(reply));
    // TODO(M1): docs/03-api.md "Proof of Charge" - GET /reservations/:id/proof -> ProofResponse.
    app.get("/reservations/:id/proof", async (_req, reply) => notImplemented(reply));
  };
}
