import { env } from "../env";
import { getWalletAddress } from "../wallet";
import type { ApiClient } from "./client";
import { createLiveApiClient } from "./live";

export { ApiRequestError, type ApiClient } from "./client";

let client: ApiClient | null = null;

const getWallet = () => getWalletAddress();

/** Returns the process-wide Fastify API client. */
export function getApiClient(): ApiClient {
  client ??= createLiveApiClient({ baseUrl: env.apiUrl, getWallet });
  return client;
}
