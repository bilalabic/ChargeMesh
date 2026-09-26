/**
 * Environment configuration (docs/02-mimari.md, "Ortam değişkenleri").
 * Parsed once at startup with zod; invalid values fail fast.
 */
import { ChainMode, anvilLocal, monadTestnet } from "@chargemesh/shared";
import { z } from "zod";

const Port = z.coerce.number().int().min(1).max(65_535);

/** Treats empty strings as "not set" so `.env` lines like `FOO=` fall back to defaults. */
const optionalString = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

const BooleanFlag = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: Port.default(4000),
  OCPP_PORT: Port.default(9000),
  MONGODB_URI: optionalString(
    z.string().regex(/^mongodb(\+srv)?:\/\//, "MONGODB_URI must be a mongodb:// or mongodb+srv:// URI"),
  ),
  MONGODB_DB_NAME: z.string().trim().regex(/^[A-Za-z0-9_-]{1,63}$/).default("chargemesh"),
  WEB_BASE_URL: z.url().default("http://localhost:3000"),
  CHAIN_MODE: ChainMode.default("mock"),
  RPC_URL: optionalString(z.url()),
  SETTLER_PRIVATE_KEY: optionalString(
    z.string().regex(/^0x[0-9a-fA-F]{64}$/, "SETTLER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex"),
  ),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().min(5_000).max(300_000).default(30_000),
  DEMO_ALLOW_ANY_TIME: optionalString(BooleanFlag),
});

export interface AppConfigEnv {
  nodeEnv: "development" | "test" | "production";
  port: number;
  ocppPort: number;
  mongoUri: string | null;
  mongoDbName: string;
  webBaseUrl: string;
  chainMode: ChainMode;
  chainId: number;
  rpcUrl: string | null;
  settlerPrivateKey: `0x${string}` | null;
  quoteTtlSeconds: number;
  reconciliationIntervalMs: number;
  demoAllowAnyTime: boolean;
}

/** Chain id per mode. `mock` reuses the local Anvil id so nothing can ever hit a public network. */
export function chainIdFor(mode: ChainMode): number {
  return mode === "monad" ? monadTestnet.id : anvilLocal.id;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfigEnv {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;

  if (e.CHAIN_MODE !== "mock" && !e.SETTLER_PRIVATE_KEY) {
    throw new ConfigError(`SETTLER_PRIVATE_KEY is required when CHAIN_MODE=${e.CHAIN_MODE}`);
  }

  if (e.NODE_ENV !== "test" && !e.MONGODB_URI) {
    throw new ConfigError("MONGODB_URI is required unless NODE_ENV=test");
  }

  const defaultRpc =
    e.CHAIN_MODE === "monad"
      ? monadTestnet.rpcUrls.default.http[0]
      : e.CHAIN_MODE === "anvil"
        ? anvilLocal.rpcUrls.default.http[0]
        : undefined;

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    ocppPort: e.OCPP_PORT,
    mongoUri: e.MONGODB_URI ?? null,
    mongoDbName: e.MONGODB_DB_NAME,
    webBaseUrl: e.WEB_BASE_URL.replace(/\/+$/, ""),
    chainMode: e.CHAIN_MODE,
    chainId: chainIdFor(e.CHAIN_MODE),
    rpcUrl: e.RPC_URL ?? defaultRpc ?? null,
    settlerPrivateKey: (e.SETTLER_PRIVATE_KEY as `0x${string}` | undefined) ?? null,
    quoteTtlSeconds: e.QUOTE_TTL_SECONDS,
    reconciliationIntervalMs: e.RECONCILIATION_INTERVAL_MS,
    // Local dev defaults to true (avoids clock skew during demos); production defaults to false.
    demoAllowAnyTime: e.DEMO_ALLOW_ANY_TIME ?? e.NODE_ENV !== "production",
  };
}
