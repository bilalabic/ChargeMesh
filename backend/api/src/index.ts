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
  await store.connect();
  await store.ensureIndexes();
  const chargers = new ChargerRegistry();
  const events = new SessionEventBus();

  const app = await buildApp({ config, chain, chargers, events, store, logger: loggerOptions(config) });
  const ocpp = new OcppCentralSystem({
    port: config.ocppPort,
    registry: chargers,
    logger: app.log.child({ component: "ocpp" }),
  });

  // Never log the key; only the derived settler address.
  app.log.info(
    { chainMode: config.chainMode, chainId: config.chainId, settler: chain.settlerAddress, contract: chain.contractAddress },
    "Chain gateway ready",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "Shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
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

  await app.listen({ port: config.port, host: "localhost" });
  await ocpp.start();
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
