/**
 * Single charge point, single connector OCPP 1.6J simulator (docs/05-ocpp.md).
 * State machine: Available -> Preparing -> Charging -> Finishing -> Available.
 * The active transaction survives reconnects; the meter keeps running while offline.
 */
import { RPCClient, createRPCError } from "ocpp-rpc";
import type { SimConfig } from "./config";
import { formatKwh, nextMeterReading, powerW, whPerTick } from "./energy";

export const OCPP_PROTOCOL = "ocpp1.6";

type ConnectorStatus = "Available" | "Preparing" | "Charging" | "Finishing";
type StopReason = "Remote" | "EVDisconnected" | "Local";

interface Transaction {
  transactionId: number;
  idTag: string;
  meterStartWh: number;
}

type ClientOptions = ConstructorParameters<typeof RPCClient>[0];

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const DEFAULT_HEARTBEAT_S = 30;

/** Readable one-liner, including Node's dual-stack AggregateError (empty message). */
function describeError(err: unknown): string {
  const e = err as Error & { code?: string; errors?: unknown[] };
  if (e?.message) return e.message;
  if (e?.code) return e.code;
  const inner = e?.errors?.[0] as { code?: string; message?: string } | undefined;
  return inner?.code ?? inner?.message ?? e?.name ?? String(err);
}

export class ChargerSimulator {
  private readonly cfg: SimConfig;
  private readonly incrementWh: number;
  private readonly powerW: number;

  private client: RPCClient | null = null;
  private online = false; // socket open and BootNotification accepted
  private stopping = false; // process shutdown
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private bootRetryTimer: NodeJS.Timeout | null = null;
  private meterTimer: NodeJS.Timeout | null = null;
  private ticking = false;

  private status: ConnectorStatus = "Available";
  private meterWh: number;
  private tx: Transaction | null = null;
  /** Stop that could not be sent while offline; flushed after the next accepted boot. */
  private pendingStop: StopReason | null = null;

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.meterWh = cfg.meterStartWh;
    this.incrementWh = whPerTick(cfg);
    this.powerW = powerW(cfg.powerKw);
  }

  log(message: string): void {
    console.log(`[${this.cfg.chargePointId}] ${message}`);
  }

  start(): void {
    this.log(
      `simulator ${this.cfg.csUrl}/${this.cfg.chargePointId} · ${this.cfg.powerKw} kW · ${this.cfg.timeScale}x · ` +
        `${this.incrementWh} Wh/tick every ${this.cfg.meterIntervalMs} ms` +
        (this.cfg.vehicleAcceptWh !== null ? ` · vehicle accepts ${this.cfg.vehicleAcceptWh} Wh` : ""),
    );
    void this.connect();
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    this.online = false;
    this.clearTimers();
    this.stopMeter();
    const client = this.client;
    this.client = null;
    if (client) await client.close({ code: 1000, reason: "Simulator shutdown" }).catch(() => undefined);
    this.log("stopped");
  }

  // ---------- Connection lifecycle ----------

  private async connect(): Promise<void> {
    if (this.stopping) return;
    const client = new RPCClient({
      endpoint: this.cfg.csUrl,
      identity: this.cfg.chargePointId,
      protocols: [OCPP_PROTOCOL],
      strictMode: true,
      reconnect: false, // reconnects are handled here so the first connect also backs off
    } as ClientOptions);
    this.client = client;
    this.registerHandlers(client);

    client.once("close", () => this.onClosed(client));

    try {
      await client.connect();
    } catch (err) {
      // 'close' has already been emitted and will schedule the reconnect.
      this.log(`connect failed: ${describeError(err)}`);
      return;
    }
    await this.boot(client);
  }

  private onClosed(client: RPCClient): void {
    if (this.client !== client) return;
    this.client = null;
    const wasOnline = this.online;
    this.online = false;
    this.clearTimers();
    if (this.stopping) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempt++;
    this.log(
      `${wasOnline ? "disconnected" : "not connected"} → reconnecting in ${(jittered / 1000).toFixed(1)} s` +
        (this.tx ? ` (tx=${this.tx.transactionId} kept)` : ""),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, jittered);
  }

  private async boot(client: RPCClient): Promise<void> {
    let res: { status?: string; interval?: number };
    try {
      res = (await client.call("BootNotification", {
        chargePointVendor: "ChargeMesh",
        chargePointModel: "charger-sim",
        firmwareVersion: "0.1.0",
      })) as { status?: string; interval?: number };
    } catch (err) {
      this.log(`BootNotification failed: ${(err as Error).message}`);
      await client.close({ code: 1000, reason: "Boot failed" }).catch(() => undefined);
      return;
    }
    const interval = res.interval && res.interval > 0 ? res.interval : DEFAULT_HEARTBEAT_S;
    this.log(`connected → BootNotification: ${res.status ?? "?"}`);

    if (res.status !== "Accepted") {
      // OCPP 1.6: retry BootNotification after `interval`; send nothing else meanwhile.
      this.bootRetryTimer = setTimeout(() => {
        this.bootRetryTimer = null;
        if (this.client === client) void this.boot(client);
      }, interval * 1000);
      return;
    }

    this.online = true;
    this.reconnectAttempt = 0;
    this.startHeartbeat(client, interval);
    await this.sendStatus(this.status);

    if (this.pendingStop && this.tx) {
      await this.finishTransaction(this.pendingStop);
    } else if (this.tx && !this.meterTimer) {
      this.startMeter();
    }
  }

  private startHeartbeat(client: RPCClient, intervalS: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.client !== client || !this.online) return;
      client.call("Heartbeat", {}).catch((err: unknown) => this.log(`Heartbeat failed: ${(err as Error).message}`));
    }, intervalS * 1000);
  }

  private clearTimers(): void {
    for (const t of [this.reconnectTimer, this.bootRetryTimer]) if (t) clearTimeout(t);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.bootRetryTimer = null;
    this.heartbeatTimer = null;
  }

  // ---------- Central System -> Charge Point ----------

  private registerHandlers(client: RPCClient): void {
    client.handle("RemoteStartTransaction", async ({ params }) => {
      const p = (params ?? {}) as { connectorId?: number; idTag?: string };
      const idTag = p.idTag ?? "";
      const connectorOk = p.connectorId === undefined || p.connectorId === this.cfg.connectorId;
      const accepted = this.online && connectorOk && this.status === "Available" && !this.tx;
      const status = accepted ? "Accepted" : "Rejected";
      this.log(`RemoteStartTransaction idTag=${idTag} → ${status}`);
      if (accepted) {
        this.status = "Preparing"; // claim the connector before replying
        setTimeout(() => void this.beginTransaction(idTag), 0);
      }
      return { status };
    });

    client.handle("RemoteStopTransaction", async ({ params }) => {
      const p = (params ?? {}) as { transactionId?: number };
      const accepted = this.tx !== null && this.tx.transactionId === p.transactionId;
      const status = accepted ? "Accepted" : "Rejected";
      this.log(`RemoteStopTransaction tx=${p.transactionId ?? "?"} → ${status}`);
      if (accepted) setTimeout(() => void this.finishTransaction("Remote"), 0);
      return { status };
    });

    client.handle(async ({ method }) => {
      this.log(`${method} → NotImplemented`);
      throw createRPCError("NotImplemented", `${method} is not supported by the simulator`);
    });
  }

  // ---------- Transaction flow ----------

  private async beginTransaction(idTag: string): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await this.sendStatus("Preparing");
      const meterStart = this.meterWh;
      const res = (await client.call("StartTransaction", {
        connectorId: this.cfg.connectorId,
        idTag,
        meterStart,
        timestamp: new Date().toISOString(),
      })) as { transactionId: number; idTagInfo?: { status?: string } };

      const tagStatus = res.idTagInfo?.status ?? "?";
      if (tagStatus !== "Accepted") {
        this.log(`StartTransaction tx=${res.transactionId} idTag ${tagStatus} → back to Available`);
        await this.sendStatus("Available");
        return;
      }
      this.tx = { transactionId: res.transactionId, idTag, meterStartWh: meterStart };
      this.log(`StartTransaction tx=${res.transactionId} meterStart=${meterStart}`);
      await this.sendStatus("Charging");
      this.startMeter();
    } catch (err) {
      this.log(`StartTransaction failed: ${(err as Error).message}`);
      if (!this.tx) await this.sendStatus("Available").catch(() => undefined);
    }
  }

  private startMeter(): void {
    this.stopMeter();
    this.meterTimer = setInterval(() => void this.tick(), this.cfg.meterIntervalMs);
  }

  private stopMeter(): void {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
  }

  private async tick(): Promise<void> {
    const tx = this.tx;
    if (!tx || this.ticking || this.pendingStop) return;
    this.ticking = true;
    try {
      const step = nextMeterReading({
        meterStartWh: tx.meterStartWh,
        currentWh: this.meterWh,
        incrementWh: this.incrementWh,
        vehicleAcceptWh: this.cfg.vehicleAcceptWh,
      });
      this.meterWh = step.energyWh;
      const client = this.client;

      if (client && this.online) {
        await client.call("MeterValues", {
          connectorId: this.cfg.connectorId,
          transactionId: tx.transactionId,
          meterValue: [
            {
              timestamp: new Date().toISOString(),
              sampledValue: [
                {
                  value: String(step.energyWh),
                  measurand: "Energy.Active.Import.Register",
                  unit: "Wh",
                  context: "Sample.Periodic",
                },
                {
                  value: String(this.powerW),
                  measurand: "Power.Active.Import",
                  unit: "W",
                  context: "Sample.Periodic",
                },
              ],
            },
          ],
        });
        this.log(
          `MeterValues ${step.energyWh} Wh · ${this.powerW} W · delivered ${formatKwh(step.deliveredWh)} kWh`,
        );
      }

      if (step.vehicleFull) {
        this.log(`vehicle accepted ${step.deliveredWh} Wh → EVDisconnected`);
        await this.finishTransaction("EVDisconnected");
      }
    } catch (err) {
      this.log(`MeterValues failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async finishTransaction(reason: StopReason): Promise<void> {
    const tx = this.tx;
    if (!tx) return;
    this.stopMeter();
    const client = this.client;
    if (!client || !this.online) {
      this.pendingStop = reason; // flushed after reconnect + boot
      this.log(`StopTransaction tx=${tx.transactionId} queued (offline) reason=${reason}`);
      return;
    }
    try {
      await this.sendStatus("Finishing");
      await client.call("StopTransaction", {
        transactionId: tx.transactionId,
        idTag: tx.idTag,
        meterStop: this.meterWh,
        timestamp: new Date().toISOString(),
        reason,
      });
      this.log(`StopTransaction tx=${tx.transactionId} meterStop=${this.meterWh} reason=${reason}`);
      this.tx = null;
      this.pendingStop = null;
      await this.sendStatus("Available");
    } catch (err) {
      this.pendingStop = reason;
      this.log(`StopTransaction failed (will retry after reconnect): ${(err as Error).message}`);
    }
  }

  private async sendStatus(status: ConnectorStatus): Promise<void> {
    const changed = status !== this.status;
    this.status = status;
    const client = this.client;
    if (!client || !this.online) return;
    await client.call("StatusNotification", {
      connectorId: this.cfg.connectorId,
      errorCode: "NoError",
      status,
      timestamp: new Date().toISOString(),
    });
    if (changed || status !== "Available") this.log(`StatusNotification ${status}`);
  }
}
