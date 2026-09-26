/**
 * Environment configuration (docs/02-mimari.md, "Ortam değişkenleri").
 * Parsed once at startup with zod; invalid values fail fast.
 */
import { ChainMode, anvilLocal, monadTestnet } from "@chargemesh/shared";
import { z } from "zod";

const Port = z.coerce.number().int().min(1).max(65_535);

const HttpUrl = z.url().superRefine((value, ctx) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    ctx.addIssue({ code: "custom", message: "must use http:// or https://" });
  }
});

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
  WEB_BASE_URL: HttpUrl.default("http://localhost:3000"),
  CHAIN_MODE: ChainMode,
  RPC_URL: optionalString(HttpUrl),
  SETTLER_PRIVATE_KEY: optionalString(
    z.string()
      .regex(/^0x[0-9a-fA-F]{64}$/, "SETTLER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex")
      .refine((value) => !/^0x0{64}$/i.test(value), "SETTLER_PRIVATE_KEY cannot be the zero key"),
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
  // Tests may omit CHAIN_MODE for convenience. Every runnable environment must
  // choose a chain explicitly so a missing variable can never enable mock mode.
  const normalizedEnv = env.NODE_ENV === "test" && !env.CHAIN_MODE
    ? { ...env, CHAIN_MODE: "mock" }
    : env;
  const parsed = EnvSchema.safeParse(normalizedEnv);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;

  if (e.CHAIN_MODE === "mock" && e.NODE_ENV !== "test") {
    throw new ConfigError("CHAIN_MODE=mock is only allowed when NODE_ENV=test");
  }

  if (e.NODE_ENV === "production" && e.CHAIN_MODE !== "monad") {
    throw new ConfigError("Production requires CHAIN_MODE=monad");
  }

  if (e.CHAIN_MODE !== "mock" && !e.SETTLER_PRIVATE_KEY) {
    throw new ConfigError(`SETTLER_PRIVATE_KEY is required when CHAIN_MODE=${e.CHAIN_MODE}`);
  }

  if (e.NODE_ENV !== "test" && !e.MONGODB_URI) {
    throw new ConfigError("MONGODB_URI is required unless NODE_ENV=test");
  }

  if (e.NODE_ENV === "production" && !e.RPC_URL) {
    throw new ConfigError("RPC_URL is required in production");
  }

  if (e.NODE_ENV === "production" && new URL(e.WEB_BASE_URL).protocol !== "https:") {
    throw new ConfigError("WEB_BASE_URL must use https:// in production");
  }

  if (e.NODE_ENV === "production" && e.RPC_URL && new URL(e.RPC_URL).protocol !== "https:") {
    throw new ConfigError("RPC_URL must use https:// in production");
  }

  if (e.NODE_ENV !== "test" && e.DEMO_ALLOW_ANY_TIME) {
    throw new ConfigError("DEMO_ALLOW_ANY_TIME=true is only allowed when NODE_ENV=test");
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
    demoAllowAnyTime: e.DEMO_ALLOW_ANY_TIME ?? e.NODE_ENV === "test",
  };
}
