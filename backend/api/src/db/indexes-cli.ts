import { ConfigError, loadConfig } from "../config";
import { MongoStore } from "./mongo";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.mongoUri) throw new ConfigError("MONGODB_URI is required");
  const store = new MongoStore(config.mongoUri, config.mongoDbName);
  try {
    await store.connect();
    await store.ensureIndexes();
    console.log(`MongoDB indexes are ready for database ${config.mongoDbName}`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`MongoDB index setup failed: ${message}`);
  process.exit(1);
});
