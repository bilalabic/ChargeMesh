/**
 * ChargeMesh OCPP 1.6J charger simulator CLI (docs/05-ocpp.md).
 *   corepack pnpm --filter @chargemesh/charger-sim dev -- --vehicle-accept 14500
 */
import { SimConfigError, loadSimConfig, type SimConfig } from "./config";
import { ChargerSimulator } from "./simulator";

let config: SimConfig;
try {
  config = loadSimConfig();
} catch (err) {
  if (err instanceof SimConfigError) {
    console.error(`charger-sim: ${err.message}`);
    console.error("Usage: charger-sim [--url ws://host:9000/ocpp] [--id CP-ID] [--power kW] [--scale N] [--vehicle-accept Wh]");
    process.exit(1);
  }
  throw err;
}

const sim = new ChargerSimulator(config);

let exiting = false;
const exit = (signal: string) => {
  if (exiting) return;
  exiting = true;
  sim.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 5_000);
  force.unref();
  void sim.shutdown().finally(() => process.exit(0));
};
process.once("SIGINT", () => exit("SIGINT"));
process.once("SIGTERM", () => exit("SIGTERM"));

sim.start();
