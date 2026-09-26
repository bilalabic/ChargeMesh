import { API_PREFIX, ApiError, AppConfig, HealthResponse } from "@chargemesh/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { createMockChainGateway } from "./chain";
import { loadConfig } from "./config";
import { ChargerRegistry } from "./ocpp/server";

const config = loadConfig({ NODE_ENV: "test", CHAIN_MODE: "mock" });
const chain = createMockChainGateway({ chainId: config.chainId });
const chargers = new ChargerRegistry();

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ config, chain, chargers });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("system routes", () => {
  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body).toEqual({ status: "ok", chainMode: "mock", chainId: config.chainId });
  });

  it("GET /api/v1/config", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/config` });
    expect(res.statusCode).toBe(200);
    const body = AppConfig.parse(res.json());
    expect(body.chainMode).toBe("mock");
    expect(body.chainId).toBe(config.chainId);
    expect(body.settlerAddress).toBe(chain.settlerAddress.toLowerCase());
    expect(body.contractAddress).toBe(chain.contractAddress.toLowerCase());
    expect(body.quoteTtlSeconds).toBe(300);
    expect(body.explorerUrl).toBeNull();
  });

  it("GET /api/v1/chargers reflects the OCPP registry", async () => {
    chargers.markConnected("CM-TEST-001", new Date("2026-10-03T07:00:00.000Z"));
    chargers.setConnectorStatus("CM-TEST-001", 1, "Available", new Date("2026-10-03T07:00:01.000Z"));
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/chargers` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        chargePointId: "CM-TEST-001",
        connected: true,
        lastSeenAt: "2026-10-03T07:00:01.000Z",
        connectorStatus: "Available",
      },
    ]);
  });
});

describe("error format", () => {
  it("unknown route -> 404 NOT_FOUND", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/does-not-exist` });
    expect(res.statusCode).toBe(404);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.details).toBeNull();
  });

  it("M1 stub -> 501 INTERNAL 'Not implemented (M1)'", async () => {
    const res = await app.inject({ method: "POST", url: `${API_PREFIX}/intents`, payload: {} });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({
      error: { code: "INTERNAL", message: "Not implemented (M1)", details: null },
    });
  });

  it("malformed JSON -> 400 VALIDATION_ERROR", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/intents`,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("config", () => {
  it("defaults to CHAIN_MODE=mock", () => {
    expect(loadConfig({}).chainMode).toBe("mock");
  });

  it("fails fast on invalid values", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
    expect(() => loadConfig({ CHAIN_MODE: "mainnet" })).toThrow(/CHAIN_MODE/);
    expect(() => loadConfig({ CHAIN_MODE: "monad" })).toThrow(/SETTLER_PRIVATE_KEY/);
  });
});
