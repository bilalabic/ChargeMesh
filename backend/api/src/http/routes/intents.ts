import { randomUUID } from "node:crypto";
import {
  CreateIntentRequest,
  MatchesResponse,
} from "@chargemesh/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { findMatches, toChargeIntent } from "../../domain";
import type { IntentDocument } from "../../db/types";
import { assertOwner, requireWallet } from "../auth";
import { ApiError } from "../errors";
import type { RouteDeps } from "./deps";

const IntentParams = z.object({ intentId: z.uuid() });

export function intentRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.post("/intents", async (request, reply) => {
      const wallet = requireWallet(request);
      const input = CreateIntentRequest.parse(request.body);
      const arriveAt = new Date(input.arriveAt);
      const departAt = new Date(input.departAt);
      const now = new Date();
      if (departAt <= now) throw new ApiError("VALIDATION_ERROR", "Intent departure must be in the future");
      const document: IntentDocument = {
        _id: randomUUID(),
        driverAddress: wallet,
        lat: input.lat,
        lng: input.lng,
        radiusKm: input.radiusKm ?? 3,
        arriveAt,
        departAt,
        requestedWh: input.requestedWh,
        connectorType: input.connectorType,
        acceptedAccessTypes: input.acceptedAccessTypes ?? [
          "OPEN_PARKING",
          "GATED_PARKING",
          "BUILDING_GARAGE",
        ],
        createdAt: now,
      };
      await deps.store.createIntent(document);
      return reply.status(201).send(toChargeIntent(document));
    });

    app.get("/intents/:intentId", async (request) => {
      const wallet = requireWallet(request);
      const { intentId } = IntentParams.parse(request.params);
      const intent = await deps.store.findIntent(intentId);
      if (!intent) throw new ApiError("NOT_FOUND", "Charge intent not found");
      assertOwner(wallet, intent.driverAddress);
      return toChargeIntent(intent);
    });

    app.get("/intents/:intentId/matches", async (request) => {
      const wallet = requireWallet(request);
      const { intentId } = IntentParams.parse(request.params);
      const intent = await deps.store.findIntent(intentId);
      if (!intent) throw new ApiError("NOT_FOUND", "Charge intent not found");
      assertOwner(wallet, intent.driverAddress);
      const now = new Date();
      await deps.store.releaseExpiredHolds(now);
      return MatchesResponse.parse({
        intentId,
        generatedAt: now.toISOString(),
        matches: await findMatches(deps.store, deps.chargers, intentId, now),
      });
    });
  };
}
