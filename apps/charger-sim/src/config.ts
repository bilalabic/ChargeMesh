/**
 * Simulator configuration (docs/05-ocpp.md, "Yapılandırma"): CLI flag > env > default.
 */
import { parseArgs } from "node:util";

export interface SimConfig {
  /** Central System base URL; the charge point id is appended as the last path segment. */
  csUrl: string;
  chargePointId: string;
  connectorId: number;
  powerKw: number;
  timeScale: number;
  meterIntervalMs: number;
  meterStartWh: number;
  /** null = unlimited */
  vehicleAcceptWh: number | null;
}

export const DEFAULTS = {
  csUrl: "ws://localhost:9000/ocpp",
  chargePointId: "CM-DEMO-001",
  connectorId: 1,
  powerKw: 7.4,
  timeScale: 120,
  meterIntervalMs: 2000,
  meterStartWh: 1_000_000,
} as const;

export class SimConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimConfigError";
  }
}

function pick(flag: string | undefined, env: string | undefined): string | undefined {
  if (flag !== undefined && flag.trim() !== "") return flag.trim();
  if (env !== undefined && env.trim() !== "") return env.trim();
  return undefined;
}

function num(
  name: string,
  raw: string | undefined,
  fallback: number,
  opts: { integer?: boolean; min: number; exclusiveMin?: boolean },
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const tooSmall = opts.exclusiveMin ? value <= opts.min : value < opts.min;
  if (!Number.isFinite(value) || tooSmall || (opts.integer && !Number.isInteger(value))) {
    const kind = opts.integer ? "an integer" : "a number";
    const bound = `${opts.exclusiveMin ? ">" : ">="} ${opts.min}`;
    throw new SimConfigError(`${name} must be ${kind} ${bound} (got "${raw}")`);
  }
  return value;
}

export function loadSimConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): SimConfig {
  // `pnpm dev -- --flag` may forward the literal "--"; drop it so flags still parse.
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        url: { type: "string" },
        id: { type: "string" },
        power: { type: "string" },
        scale: { type: "string" },
        "vehicle-accept": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    throw new SimConfigError((err as Error).message);
  }

  const csUrl = (pick(values.url, env.CS_URL) ?? DEFAULTS.csUrl).replace(/\/+$/, "");
  if (!/^wss?:\/\//.test(csUrl)) {
    throw new SimConfigError(`CS_URL must start with ws:// or wss:// (got "${csUrl}")`);
  }
  const chargePointId = pick(values.id, env.CHARGE_POINT_ID) ?? DEFAULTS.chargePointId;
  if (!/^[A-Za-z0-9._-]{3,48}$/.test(chargePointId)) {
    throw new SimConfigError(`CHARGE_POINT_ID must match ^[A-Za-z0-9._-]{3,48}$ (got "${chargePointId}")`);
  }

  const vehicleRaw = pick(values["vehicle-accept"], env.VEHICLE_ACCEPT_WH);

  return {
    csUrl,
    chargePointId,
    connectorId: num("CONNECTOR_ID", pick(undefined, env.CONNECTOR_ID), DEFAULTS.connectorId, {
      integer: true,
      min: 1,
    }),
    powerKw: num("POWER_KW", pick(values.power, env.POWER_KW), DEFAULTS.powerKw, {
      min: 0,
      exclusiveMin: true,
    }),
    timeScale: num("TIME_SCALE", pick(values.scale, env.TIME_SCALE), DEFAULTS.timeScale, {
      min: 0,
      exclusiveMin: true,
    }),
    meterIntervalMs: num(
      "METER_INTERVAL_MS",
      pick(undefined, env.METER_INTERVAL_MS),
      DEFAULTS.meterIntervalMs,
      { integer: true, min: 100 },
    ),
    meterStartWh: num("METER_START_WH", pick(undefined, env.METER_START_WH), DEFAULTS.meterStartWh, {
      integer: true,
      min: 0,
    }),
    vehicleAcceptWh:
      vehicleRaw === undefined
        ? null
        : num("VEHICLE_ACCEPT_WH", vehicleRaw, 0, { integer: true, min: 1 }),
  };
}
