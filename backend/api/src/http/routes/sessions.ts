import { ChargingSession, StartSessionRequest } from "@chargemesh/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SessionDocument } from "../../db/types";
import { requireWallet } from "../auth";
import { ApiError } from "../errors";
import type { RouteDeps } from "./deps";

const SessionParams = z.object({ id: z.uuid() });

async function authorizeSession(
  deps: RouteDeps,
  request: FastifyRequest,
  allowQuery = false,
): Promise<{ session: SessionDocument; wallet: string }> {
  const wallet = requireWallet(request, { allowQuery });
  const { id } = SessionParams.parse(request.params);
  const session = await deps.store.findSession(id);
  if (!session) throw new ApiError("NOT_FOUND", "Charging session not found");
  const reservation = await deps.store.findReservation(session.reservationId);
  if (!reservation) throw new ApiError("NOT_FOUND", "Reservation not found");
  if (wallet !== reservation.driverAddress && wallet !== reservation.hostAddress) {
    throw new ApiError("FORBIDDEN", "Charging session does not belong to this wallet");
  }
  return { session, wallet };
}

export function sessionRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.post("/sessions/start", async (request, reply) => {
      const wallet = requireWallet(request);
      const input = StartSessionRequest.parse(request.body);
      const session = await deps.sessions.start(wallet, input);
      return reply.status(201).send(ChargingSession.parse(deps.sessions.toView(session)));
    });

    app.get("/sessions/:id", async (request) => {
      const { session } = await authorizeSession(deps, request);
      return ChargingSession.parse(deps.sessions.toView(session));
    });

    app.post("/sessions/:id/stop", async (request) => {
      const { session } = await authorizeSession(deps, request);
      const stopped = await deps.sessions.requestStop(session);
      return ChargingSession.parse(deps.sessions.toView(stopped));
    });

    app.get("/sessions/:id/events", async (request, reply) => {
      const { session } = await authorizeSession(deps, request, true);
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.flushHeaders();

      const send = (event: string, data: unknown) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };
      send("session.updated", ChargingSession.parse(deps.sessions.toView(session)));
      const unsubscribe = deps.events.subscribe(session._id, (event) => send(event.event, event.data));
      const ping = setInterval(() => {
        if (!reply.raw.writableEnded) reply.raw.write(": ping\n\n");
      }, 15_000);
      ping.unref();
      request.raw.once("close", () => {
        clearInterval(ping);
        unsubscribe();
      });
      return reply;
    });
  };
}
