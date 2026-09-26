import type { ChainGateway } from "../../chain";
import type { AppConfigEnv } from "../../config";
import type { Store } from "../../db/store";
import type { ChargerRegistry, OcppCentralSystem } from "../../ocpp/server";
import type { SessionEventBus } from "../../sessions/events";
import type { ChargingSessionService } from "../../sessions/service";

/** Everything route plugins may depend on. Injected by buildApp() (tests pass fakes). */
export interface RouteDeps {
  config: AppConfigEnv;
  chain: ChainGateway;
  chargers: ChargerRegistry;
  events: SessionEventBus;
  sessions: ChargingSessionService;
  /** Null when the OCPP server is not running (e.g. tests). */
  ocpp: OcppCentralSystem | null;
  store: Store;
}
