/**
 * OCPP 1.6J Central System (docs/05-ocpp.md) on ws://host:OCPP_PORT/ocpp/{chargePointId}.
 * Uses ocpp-rpc RPCServer with strict schema validation. Keeps an in-memory charger
 * registry that GET /chargers reads.
 */
import type { ChargerStatus } from "@chargemesh/shared";
import { RPCServer, createRPCError, type RPCClient } from "ocpp-rpc";

export const OCPP_PROTOCOL = "ocpp1.6";
export const OCPP_ENDPOINT = "/ocpp";
export const HEARTBEAT_INTERVAL_SECONDS = 30;

/** Minimal logger shape (satisfied by pino / Fastify's logger). */
export interface OcppLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

// ---------- Charger registry ----------

interface ChargerEntry {
  chargePointId: string;
  connected: boolean;
  lastSeenAt: Date | null;
  /** connectorId -> OCPP ChargePointStatus. Connector 0 is the whole charge point. */
  connectors: Map<number, string>;
}

export class ChargerRegistry {
  private readonly entries = new Map<string, ChargerEntry>();

  private entry(chargePointId: string): ChargerEntry {
    let e = this.entries.get(chargePointId);
    if (!e) {
      e = { chargePointId, connected: false, lastSeenAt: null, connectors: new Map() };
      this.entries.set(chargePointId, e);
    }
    return e;
  }

  markConnected(chargePointId: string, at = new Date()): void {
    const e = this.entry(chargePointId);
    e.connected = true;
    e.lastSeenAt = at;
  }

  markDisconnected(chargePointId: string): void {
    const e = this.entries.get(chargePointId);
    if (e) e.connected = false;
  }

  touch(chargePointId: string, at = new Date()): void {
    this.entry(chargePointId).lastSeenAt = at;
  }

  setConnectorStatus(chargePointId: string, connectorId: number, status: string, at = new Date()): void {
    const e = this.entry(chargePointId);
    e.connectors.set(connectorId, status);
    e.lastSeenAt = at;
  }

  isConnected(chargePointId: string): boolean {
    return this.entries.get(chargePointId)?.connected ?? false;
  }

  getConnectorStatus(chargePointId: string, connectorId: number): string | null {
    return this.entries.get(chargePointId)?.connectors.get(connectorId) ?? null;
  }

  /** ChargerStatus[] sorted by chargePointId. connectorStatus = first physical connector (fallback: 0). */
  list(): ChargerStatus[] {
    return [...this.entries.values()]
      .sort((a, b) => a.chargePointId.localeCompare(b.chargePointId))
      .map((e) => {
        const physical = [...e.connectors.keys()].filter((id) => id > 0).sort((a, b) => a - b);
        const key = physical[0] ?? 0;
        return {
          chargePointId: e.chargePointId,
          connected: e.connected,
          lastSeenAt: e.lastSeenAt ? e.lastSeenAt.toISOString() : null,
          connectorStatus: e.connectors.get(key) ?? null,
        };
      });
  }
}

// ---------- Central System ----------

export class ChargerOfflineError extends Error {
  constructor(readonly chargePointId: string) {
    super(`Charge point ${chargePointId} is not connected`);
    this.name = "ChargerOfflineError";
  }
}

export type RemoteCommandStatus = "Accepted" | "Rejected";

/** ocpp-rpc's RPCServerClient: an RPCClient with the decoded identity. */
type ServerClient = RPCClient & { readonly identity: string };

type Params = Record<string, unknown>;

export interface OcppCentralSystemOptions {
  port: number;
  host?: string;
  registry: ChargerRegistry;
  logger: OcppLogger;
  /** Outbound call timeout (RemoteStart/RemoteStop). */
  callTimeoutMs?: number;
}

export class OcppCentralSystem {
  readonly registry: ChargerRegistry;
  private readonly server: RPCServer;
  private readonly clients = new Map<string, ServerClient>();
  private readonly log: OcppLogger;
  private readonly opts: OcppCentralSystemOptions;
  // TODO(M1): replace with nextval('ocpp_transaction_id_seq') when StartTransaction persists sessions.
  private nextTransactionId = 1;

  constructor(opts: OcppCentralSystemOptions) {
    this.opts = opts;
    this.registry = opts.registry;
    this.log = opts.logger;
    this.server = new RPCServer({
      protocols: [OCPP_PROTOCOL],
      strictMode: true,
      callTimeoutMs: opts.callTimeoutMs ?? 30_000,
    });

    this.server.auth((accept, reject, handshake) => {
      if (handshake.endpoint !== OCPP_ENDPOINT) {
        reject(404, `Unknown OCPP endpoint ${handshake.endpoint}`);
        return;
      }
      accept({ chargePointId: handshake.identity });
    });

    this.server.on("client", (client: ServerClient) => this.onClient(client));
    this.server.on("error", (err: unknown) => this.log.error({ err }, "OCPP server error"));
  }

  async start(): Promise<void> {
    await this.server.listen(this.opts.port, this.opts.host);
    this.log.info({ port: this.opts.port, path: `${OCPP_ENDPOINT}/{chargePointId}` }, "OCPP Central System listening");
  }

  async stop(): Promise<void> {
    await this.server.close({ code: 1001, reason: "Server shutting down" });
    for (const id of this.clients.keys()) this.registry.markDisconnected(id);
    this.clients.clear();
  }

  isConnected(chargePointId: string): boolean {
    return this.clients.has(chargePointId);
  }

  /** Sends RemoteStartTransaction. Throws ChargerOfflineError when not connected. */
  async remoteStart(
    chargePointId: string,
    params: { connectorId: number; idTag: string },
  ): Promise<RemoteCommandStatus> {
    const client = this.requireClient(chargePointId);
    const res = (await client.call("RemoteStartTransaction", {
      connectorId: params.connectorId,
      idTag: params.idTag,
    })) as { status?: string };
    const status: RemoteCommandStatus = res.status === "Accepted" ? "Accepted" : "Rejected";
    this.log.info({ chargePointId, idTag: params.idTag, status }, "RemoteStartTransaction");
    return status;
  }

  /** Sends RemoteStopTransaction. Throws ChargerOfflineError when not connected. */
  async remoteStop(chargePointId: string, transactionId: number): Promise<RemoteCommandStatus> {
    const client = this.requireClient(chargePointId);
    const res = (await client.call("RemoteStopTransaction", { transactionId })) as { status?: string };
    const status: RemoteCommandStatus = res.status === "Accepted" ? "Accepted" : "Rejected";
    this.log.info({ chargePointId, transactionId, status }, "RemoteStopTransaction");
    return status;
  }

  private requireClient(chargePointId: string): ServerClient {
    const client = this.clients.get(chargePointId);
    if (!client) throw new ChargerOfflineError(chargePointId);
    return client;
  }

  private onClient(client: ServerClient): void {
    const cpId = client.identity;
    const previous = this.clients.get(cpId);
    if (previous && previous !== client) {
      // A charge point reconnected before the old socket timed out: keep the newest.
      void previous.close({ code: 1000, reason: "Replaced by a new connection" }).catch(() => {});
    }
    this.clients.set(cpId, client);
    this.registry.markConnected(cpId);
    this.log.info({ chargePointId: cpId }, "Charge point connected");

    client.on("close", () => {
      if (this.clients.get(cpId) === client) {
        this.clients.delete(cpId);
        this.registry.markDisconnected(cpId);
        this.log.info({ chargePointId: cpId }, "Charge point disconnected");
      }
    });
    client.on("message", () => this.registry.touch(cpId));
    // TODO(M1): persist every frame to ocpp_messages (direction, kind, action, payload).

    client.handle("BootNotification", async ({ params }) => {
      const p = (params ?? {}) as Params;
      // TODO(M1): return "Rejected" when cpId does not match a registered node's
      // ocppChargePointId (docs/05-ocpp.md, "Bağlantı"). Needs the DB lookup.
      this.log.info(
        { chargePointId: cpId, vendor: p.chargePointVendor, model: p.chargePointModel },
        "BootNotification",
      );
      return {
        status: "Accepted",
        currentTime: new Date().toISOString(),
        interval: HEARTBEAT_INTERVAL_SECONDS,
      };
    });

    client.handle("Heartbeat", async () => ({ currentTime: new Date().toISOString() }));

    client.handle("StatusNotification", async ({ params }) => {
      const p = (params ?? {}) as Params;
      const connectorId = typeof p.connectorId === "number" ? p.connectorId : 0;
      const status = typeof p.status === "string" ? p.status : "Unknown";
      this.registry.setConnectorStatus(cpId, connectorId, status);
      this.log.info({ chargePointId: cpId, connectorId, status }, "StatusNotification");
      return {};
    });

    client.handle("StartTransaction", async ({ params }) => {
      const p = (params ?? {}) as Params;
      // TODO(M1): resolve idTag -> reservation (toOcppIdTag); unknown idTag => "Invalid".
      // Allocate transactionId from ocpp_transaction_id_seq, persist meterStart, call
      // ChainGateway.startSession and publish session.updated.
      const transactionId = this.nextTransactionId++;
      this.log.info(
        { chargePointId: cpId, idTag: p.idTag, meterStart: p.meterStart, transactionId },
        "StartTransaction",
      );
      return { transactionId, idTagInfo: { status: "Accepted" } };
    });

    client.handle("MeterValues", async ({ params }) => {
      const p = (params ?? {}) as Params;
      // TODO(M1): store raw samples in meter_samples, update delivered Wh, publish `meter`
      // SSE events and send RemoteStopTransaction once deliveredWh >= requestedWh.
      this.log.debug({ chargePointId: cpId, transactionId: p.transactionId }, "MeterValues");
      return {};
    });

    client.handle("StopTransaction", async ({ params }) => {
      const p = (params ?? {}) as Params;
      // TODO(M1): deliveredWh = meterStop - meterStart -> Proof of Charge -> settle().
      this.log.info(
        { chargePointId: cpId, transactionId: p.transactionId, meterStop: p.meterStop, reason: p.reason },
        "StopTransaction",
      );
      return { idTagInfo: { status: "Accepted" } };
    });

    client.handle(async ({ method }) => {
      this.log.warn({ chargePointId: cpId, method }, "Unhandled OCPP call");
      throw createRPCError("NotImplemented", `${method} is not supported`);
    });
  }
}
