import type { ChainGateway } from "../../chain";
import type { AppConfigEnv } from "../../config";
import type { DbHandle } from "../../db/client";
import type { ChargerRegistry, OcppCentralSystem } from "../../ocpp/server";
import type { SessionEventBus } from "../../sessions/events";

/** Everything route plugins may depend on. Injected by buildApp() (tests pass fakes). */
export interface RouteDeps {
  config: AppConfigEnv;
  chain: ChainGateway;
  chargers: ChargerRegistry;
  events: SessionEventBus;
  /** Null when the OCPP server is not running (e.g. tests). */
  ocpp: OcppCentralSystem | null;
  /** Lazily connecting DB handle; null in tests that do not need PostgreSQL. */
  db: DbHandle | null;
}
