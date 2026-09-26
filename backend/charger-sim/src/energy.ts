/**
 * Pure energy math for the simulator (docs/05-ocpp.md, "Simülatör").
 * All energy values are integer Wh.
 */

export interface EnergyParams {
  powerKw: number;
  meterIntervalMs: number;
  timeScale: number;
}

/** Wh added per meter tick: round(POWER_KW*1000 * (METER_INTERVAL_MS/1000) * TIME_SCALE / 3600). */
export function whPerTick({ powerKw, meterIntervalMs, timeScale }: EnergyParams): number {
  return Math.round((powerKw * 1000 * (meterIntervalMs / 1000) * timeScale) / 3600);
}

/** Instantaneous power reported in MeterValues (Power.Active.Import, W). */
export function powerW(powerKw: number): number {
  return Math.round(powerKw * 1000);
}

export interface MeterStepInput {
  /** Register value at StartTransaction. */
  meterStartWh: number;
  /** Current register value. */
  currentWh: number;
  /** Increment for this tick (whPerTick). */
  incrementWh: number;
  /** Vehicle leaves after accepting this many Wh; null = unlimited. */
  vehicleAcceptWh: number | null;
}

export interface MeterStep {
  /** New register value (Energy.Active.Import.Register). */
  energyWh: number;
  /** energyWh - meterStartWh */
  deliveredWh: number;
  /** True when the vehicle-accept limit has been reached (clipped exactly to it). */
  vehicleFull: boolean;
}

/** Advances the meter by one tick, clipping the last sample to VEHICLE_ACCEPT_WH. */
export function nextMeterReading(input: MeterStepInput): MeterStep {
  const alreadyDelivered = input.currentWh - input.meterStartWh;
  let delivered = alreadyDelivered + input.incrementWh;
  let vehicleFull = false;
  if (input.vehicleAcceptWh !== null && delivered >= input.vehicleAcceptWh) {
    delivered = Math.max(input.vehicleAcceptWh, alreadyDelivered);
    vehicleFull = true;
  }
  return { energyWh: input.meterStartWh + delivered, deliveredWh: delivered, vehicleFull };
}

/** Display helper: Wh -> "0.49" kWh with two decimals. */
export function formatKwh(wh: number): string {
  return (wh / 1000).toFixed(2);
}
