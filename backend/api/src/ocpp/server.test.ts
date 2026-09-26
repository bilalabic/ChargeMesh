import { createServer } from "node:net";
import { RPCClient } from "ocpp-rpc";
import { afterEach, describe, expect, it } from "vitest";
import { createMockChainGateway } from "../chain";
import { loadConfig } from "../config";
import { MemoryStore } from "../db/memory";
import type { NodeDocument, OcppMessageDocument } from "../db/types";
import { SessionEventBus } from "../sessions/events";
import { ChargingSessionService } from "../sessions/service";
import { ChargerRegistry, OCPP_PROTOCOL, OcppCentralSystem } from "./server";

type ClientOptions = ConstructorParameters<typeof RPCClient>[0];

class RecordingStore extends MemoryStore {
  readonly messages: OcppMessageDocument[] = [];

  override async insertOcppMessage(document: OcppMessageDocument): Promise<void> {
    this.messages.push(document);
  }
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port allocated"));
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

describe("OCPP Central System", () => {
  const clients: RPCClient[] = [];
  const servers: OcppCentralSystem[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  async function connect(port: number, identity: string): Promise<RPCClient> {
    const client = new RPCClient({
      endpoint: `ws://127.0.0.1:${port}/ocpp`,
      identity,
      protocols: [OCPP_PROTOCOL],
      strictMode: true,
      reconnect: false,
    } as ClientOptions);
    clients.push(client);
    await client.connect();
    return client;
  }

  it("rejects an unregistered charge point and accepts a registered one while persisting frames", async () => {
    const config = loadConfig({ NODE_ENV: "test", CHAIN_MODE: "mock" });
    const store = new RecordingStore();
    const chain = createMockChainGateway({ chainId: config.chainId });
    const sessions = new ChargingSessionService(store, chain, new SessionEventBus(), config);
    const port = await availablePort();
    const registry = new ChargerRegistry();
    const central = new OcppCentralSystem({ port, host: "127.0.0.1", registry, store, sessions });
    sessions.setCommands(central);
    servers.push(central);
    await central.start();

    const unknown = await connect(port, "CM-UNKNOWN");
    const rejected = (await unknown.call("BootNotification", {
      chargePointVendor: "ChargeMesh",
      chargePointModel: "test",
    })) as { status: string };
    expect(rejected.status).toBe("Rejected");
    expect(registry.isConnected("CM-UNKNOWN")).toBe(false);

    const now = new Date();
    await store.createNode({
      _id: "57b1d79f-cf49-4cc8-a721-aaf30c3f40be",
      hostAddress: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
      name: "Test Node",
      areaLabel: "Kadıköy, İstanbul",
      addressLine: "Test address line",
      lat: 40.98,
      lng: 29.02,
      accessInstructions: "",
      connectorType: "TYPE2",
      maxPowerKw: 7.4,
      accessType: "OPEN_PARKING",
      ocppChargePointId: "CM-REGISTERED",
      ocppConnectorId: 1,
      createdAt: now,
      updatedAt: now,
    } satisfies NodeDocument);
    const registered = await connect(port, "CM-REGISTERED");
    const accepted = (await registered.call("BootNotification", {
      chargePointVendor: "ChargeMesh",
      chargePointModel: "test",
    })) as { status: string };
    expect(accepted.status).toBe("Accepted");
    expect(registry.isConnected("CM-REGISTERED")).toBe(true);
    await registered.call("StatusNotification", {
      connectorId: 1,
      errorCode: "NoError",
      status: "Available",
    });
    expect(registry.getConnectorStatus("CM-REGISTERED", 1)).toBe("Available");
    expect(store.messages.some((message) => message.action === "BootNotification" && message.direction === "IN")).toBe(true);
    expect(store.messages.some((message) => message.kind === "CALLRESULT" && message.direction === "OUT")).toBe(true);
  });
});
