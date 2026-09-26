import { getConnection } from "wagmi/actions";
import { env } from "../env";
import { wagmiConfig } from "../wagmi";
import type { ApiClient } from "./client";
import { createLiveApiClient } from "./live";
import { createMockApiClient } from "./mock";

export { ApiRequestError, type ApiClient } from "./client";

let client: ApiClient | null = null;

const getWallet = () => getConnection(wagmiConfig).address ?? null;

/** Returns the process-wide ApiClient for NEXT_PUBLIC_API_MODE (mock | live). */
export function getApiClient(): ApiClient {
  client ??=
    env.apiMode === "live"
      ? createLiveApiClient({ baseUrl: env.apiUrl, getWallet })
      : createMockApiClient({ getWallet, chainId: env.chainId });
  return client;
}
