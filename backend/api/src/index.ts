/**
 * Entry point: HTTP API (:PORT) + OCPP Central System (:OCPP_PORT).
 * Atlas is connected and its indexes are verified before HTTP/OCPP start listening.
 */
import { buildApp } from "./app";
import { createChainGateway } from "./chain";
import { ConfigError, loadConfig, type AppConfigEnv } from "./config";
import { MongoStore } from "./db/mongo";
import { ChargerRegistry, OcppCentralSystem } from "./ocpp/server";
import { SessionEventBus } from "./sessions/events";
import { ReconciliationWorker } from "./sessions/reconciliation";
import { ChargingSessionService } from "./sessions/service";

function loggerOptions(config: AppConfigEnv) {
  if (config.nodeEnv === "production") return { level: "info" };
  return {
    level: config.nodeEnv === "test" ? "warn" : "info",
    transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
  };
}

async function main(): Promise<void> {
  let config: AppConfigEnv;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const chain = createChainGateway(config);
  if (!config.mongoUri) throw new ConfigError("MONGODB_URI is required");
  const store = new MongoStore(config.mongoUri, config.mongoDbName);
  try {
    await store.connect();
    await store.ensureIndexes();
    await chain.assertReady();
  } catch (err) {
    await store.close().catch(() => undefined);
    throw err;
  }
  const chargers = new ChargerRegistry();
  const events = new SessionEventBus();
  const sessions = new ChargingSessionService(store, chain, events, config);
  const ocpp = new OcppCentralSystem({
    port: config.ocppPort,
    registry: chargers,
    store,
    sessions,
  });
  sessions.setCommands(ocpp);
  const app = await buildApp({ config, chain, chargers, events, sessions, ocpp, store, logger: loggerOptions(config) });
  ocpp.setLogger(app.log.child({ component: "ocpp" }));
  const reconciliation = new ReconciliationWorker(
    store,
    chain,
    sessions,
    events,
    config.reconciliationIntervalMs,
    app.log.child({ component: "reconciliation" }),
  );

  // Never log the key; only the derived settler address.
  app.log.info(
    { chainMode: config.chainMode, chainId: config.chainId, settler: chain.settlerAddress, contract: chain.contractAddress },
    "Chain gateway ready",
  );
  await reconciliation.runOnce();
  reconciliation.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      reconciliation.stop();
      await ocpp.stop();
      await app.close();
      await store.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await ocpp.start();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
