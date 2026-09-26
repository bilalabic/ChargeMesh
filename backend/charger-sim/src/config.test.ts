import { describe, expect, it } from "vitest";
import { DEFAULTS, loadSimConfig } from "./config";

describe("loadSimConfig", () => {
  it("uses defaults", () => {
    expect(loadSimConfig([], {})).toEqual({ ...DEFAULTS, vehicleAcceptWh: null });
  });

  it("CLI flags override env, env overrides defaults", () => {
    const cfg = loadSimConfig(["--", "--power", "11", "--vehicle-accept", "14500", "--id", "CP-FLAG"], {
      POWER_KW: "3.7",
      TIME_SCALE: "60",
      CHARGE_POINT_ID: "CP-ENV",
      CS_URL: "ws://example.test:9000/ocpp/",
      METER_INTERVAL_MS: "1000",
    });
    expect(cfg.powerKw).toBe(11);
    expect(cfg.timeScale).toBe(60);
    expect(cfg.chargePointId).toBe("CP-FLAG");
    expect(cfg.csUrl).toBe("ws://example.test:9000/ocpp");
    expect(cfg.meterIntervalMs).toBe(1000);
    expect(cfg.vehicleAcceptWh).toBe(14_500);
  });

  it("treats an empty VEHICLE_ACCEPT_WH as unlimited and rejects invalid values", () => {
    expect(loadSimConfig([], { VEHICLE_ACCEPT_WH: "" }).vehicleAcceptWh).toBeNull();
    expect(() => loadSimConfig(["--power=0"], {})).toThrow(/POWER_KW/);
    expect(() => loadSimConfig([], { CONNECTOR_ID: "1.5" })).toThrow(/CONNECTOR_ID/);
    expect(() => loadSimConfig(["--unknown"], {})).toThrow();
  });
});
