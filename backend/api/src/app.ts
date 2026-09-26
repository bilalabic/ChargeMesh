/**
 * buildApp(): the Fastify instance without listen(), so tests can use app.inject().
 */
import cors from "@fastify/cors";
import { API_PREFIX, WALLET_HEADER } from "@chargemesh/shared";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { ChainGateway } from "./chain";
import type { AppConfigEnv } from "./config";
import { MemoryStore } from "./db/memory";
import type { Store } from "./db/store";
import { registerAuth } from "./http/auth";
import { registerErrorHandling } from "./http/errors";
import { demoRoutes } from "./http/routes/demo";
import type { RouteDeps } from "./http/routes/deps";
import { intentRoutes } from "./http/routes/intents";
import { nodeRoutes } from "./http/routes/nodes";
import { reservationRoutes } from "./http/routes/reservations";
import { sessionRoutes } from "./http/routes/sessions";
import { slotRoutes } from "./http/routes/slots";
import { healthPayload, systemRoutes } from "./http/routes/system";
import { ChargerRegistry, type OcppCentralSystem } from "./ocpp/server";
import { SessionEventBus } from "./sessions/events";

export interface AppDeps {
  config: AppConfigEnv;
  chain: ChainGateway;
  chargers?: ChargerRegistry;
  events?: SessionEventBus;
  ocpp?: OcppCentralSystem | null;
  store?: Store;
  /** Fastify logger option; defaults to off (tests). */
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const routeDeps: RouteDeps = {
    config: deps.config,
    chain: deps.chain,
    chargers: deps.chargers ?? deps.ocpp?.registry ?? new ChargerRegistry(),
    events: deps.events ?? new SessionEventBus(),
    ocpp: deps.ocpp ?? null,
    store: deps.store ?? new MemoryStore(),
  };

  const app = Fastify({ logger: deps.logger ?? false });

  registerErrorHandling(app);
  registerAuth(app);

  await app.register(cors, {
    origin: deps.config.webBaseUrl,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", WALLET_HEADER],
  });

  app.get("/health", async () => healthPayload(routeDeps));

  await app.register(
    async (api) => {
      await api.register(systemRoutes(routeDeps));
      await api.register(demoRoutes(routeDeps));
      await api.register(nodeRoutes(routeDeps));
      await api.register(slotRoutes(routeDeps));
      await api.register(intentRoutes(routeDeps));
      await api.register(reservationRoutes(routeDeps));
      await api.register(sessionRoutes(routeDeps));
    },
    { prefix: API_PREFIX },
  );

  return app;
}
