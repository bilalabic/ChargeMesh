import { describe, expect, it } from "vitest";
import { formatKwh, nextMeterReading, powerW, whPerTick } from "./energy";

const demo = { powerKw: 7.4, meterIntervalMs: 2000, timeScale: 120 };

describe("whPerTick", () => {
  it("7.4 kW, 2000 ms, 120x -> 493 Wh per tick", () => {
    expect(whPerTick(demo)).toBe(493);
  });

  it("is an integer and scales linearly with time scale", () => {
    expect(whPerTick({ ...demo, timeScale: 1 })).toBe(4); // 4.11 -> 4
    expect(whPerTick({ ...demo, timeScale: 240 })).toBe(987); // 986.67 -> 987
    expect(Number.isInteger(whPerTick({ powerKw: 3.3, meterIntervalMs: 1500, timeScale: 77 }))).toBe(true);
  });

  it("20 kWh takes about 81 seconds at the demo settings", () => {
    const ticks = Math.ceil(20_000 / whPerTick(demo));
    expect((ticks * demo.meterIntervalMs) / 1000).toBeCloseTo(82, 0);
  });
});

describe("nextMeterReading", () => {
  it("adds the increment when there is no vehicle limit", () => {
    expect(
      nextMeterReading({ meterStartWh: 1_000_000, currentWh: 1_000_000, incrementWh: 493, vehicleAcceptWh: null }),
    ).toEqual({ energyWh: 1_000_493, deliveredWh: 493, vehicleFull: false });
  });

  it("clipping yields exactly 14500 Wh delivered", () => {
    const increment = whPerTick(demo);
    const start = 1_000_000;
    let current = start;
    let ticks = 0;
    let step = nextMeterReading({ meterStartWh: start, currentWh: current, incrementWh: increment, vehicleAcceptWh: 14_500 });
    while (!step.vehicleFull) {
      current = step.energyWh;
      ticks++;
      expect(ticks).toBeLessThan(1_000);
      step = nextMeterReading({ meterStartWh: start, currentWh: current, incrementWh: increment, vehicleAcceptWh: 14_500 });
    }
    expect(step.deliveredWh).toBe(14_500);
    expect(step.energyWh).toBe(1_014_500);
    // 29 full ticks (14297 Wh) + one clipped tick.
    expect(ticks).toBe(29);
  });

  it("marks the vehicle full on an exact hit", () => {
    expect(
      nextMeterReading({ meterStartWh: 0, currentWh: 500, incrementWh: 500, vehicleAcceptWh: 1_000 }),
    ).toEqual({ energyWh: 1_000, deliveredWh: 1_000, vehicleFull: true });
  });
});

describe("display helpers", () => {
  it("formats power and kWh", () => {
    expect(powerW(7.4)).toBe(7400);
    expect(formatKwh(493)).toBe("0.49");
  });
});
