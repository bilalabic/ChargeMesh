import { env } from "../env";
import { getWalletAddress } from "../wallet";
import type { ApiClient } from "./client";
import { createLiveApiClient } from "./live";
import { createMockApiClient } from "./mock";

export { ApiRequestError, type ApiClient } from "./client";

let client: ApiClient | null = null;

const getWallet = () => getWalletAddress();

/** Returns the process-wide ApiClient for VITE_API_MODE (mock | live). */
export function getApiClient(): ApiClient {
  client ??=
    env.apiMode === "live"
      ? createLiveApiClient({ baseUrl: env.apiUrl, getWallet })
      : createMockApiClient({ getWallet, chainId: 31337 });
  return client;
}
