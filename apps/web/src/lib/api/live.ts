import {
  API_ERROR_HTTP_STATUS,
  ApiError,
  AppConfig,
  ChargeIntent,
  ChargerStatus,
  ChargingNode,
  ChargingSession,
  CreateReservationResponse,
  DemoSeedResponse,
  EnergySlot,
  MatchesResponse,
  ProofResponse,
  PublicChargingNode,
  Reservation,
  WALLET_HEADER,
  WALLET_QUERY_PARAM,
  routes,
} from "@chargemesh/shared";
import { z } from "zod";
import { ApiRequestError, type ApiClient, type WalletGetter } from "./client";

export interface LiveApiClientOptions {
  /** e.g. http://localhost:4000/api/v1 (no trailing slash needed). */
  baseUrl: string;
  getWallet: WalletGetter;
  fetch?: typeof fetch;
}

type Method = "GET" | "POST";

export function createLiveApiClient(options: LiveApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { accept: "application/json" };
    const wallet = options.getWallet();
    if (wallet) headers[WALLET_HEADER] = wallet;
    if (body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new ApiRequestError("INTERNAL", `Network error: ${String(cause)}`, 0);
    }

    const payload: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const parsed = ApiError.safeParse(payload);
      if (parsed.success) {
        const { code, message, details } = parsed.data.error;
        throw new ApiRequestError(code, message, res.status, details);
      }
      throw new ApiRequestError("INTERNAL", `Unexpected HTTP ${res.status}`, res.status, payload);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiRequestError(
        "INTERNAL",
        `Response for ${method} ${path} does not match the contract`,
        API_ERROR_HTTP_STATUS.INTERNAL,
        z.treeifyError(parsed.error),
      );
    }
    return parsed.data;
  }

  const get = <S extends z.ZodType>(path: string, schema: S) => request("GET", path, schema);
  const post = <S extends z.ZodType>(path: string, schema: S, body?: unknown) =>
    request("POST", path, schema, body ?? {});

  return {
    config: () => get(routes.config(), AppConfig),
    chargers: () => get(routes.chargers(), z.array(ChargerStatus)),
    demoSeed: () => post(routes.demoSeed(), DemoSeedResponse),

    createNode: (body) => post(routes.nodes(), ChargingNode, body),
    listMyNodes: () => get(`${routes.nodes()}?mine=true`, z.array(ChargingNode)),
    // ChargingNode first: zod strips unknown keys, so the public schema would also
    // accept (and truncate) a full node.
    getNode: (nodeId) => get(routes.node(nodeId), z.union([ChargingNode, PublicChargingNode])),
    createSlot: (nodeId, body) => post(routes.nodeSlots(nodeId), EnergySlot, body),
    listSlots: (nodeId) => get(routes.nodeSlots(nodeId), z.array(EnergySlot)),
    closeSlot: (slotId) => post(routes.closeSlot(slotId), EnergySlot),
    listNodeReservations: (nodeId) =>
      get(routes.nodeReservations(nodeId), z.array(Reservation)),

    createIntent: (body) => post(routes.intents(), ChargeIntent, body),
    getIntent: (intentId) => get(routes.intent(intentId), ChargeIntent),
    getMatches: (intentId) => get(routes.intentMatches(intentId), MatchesResponse),
    createReservation: (body) => post(routes.reservations(), CreateReservationResponse, body),
    confirmReservation: (id, body) => post(routes.confirmReservation(id), Reservation, body),
    syncReservation: (id, body) => post(routes.syncReservation(id), Reservation, body ?? {}),
    listReservations: (role) =>
      get(`${routes.reservations()}?role=${encodeURIComponent(role)}`, z.array(Reservation)),
    getReservation: (id) => get(routes.reservation(id), Reservation),
    getProof: (id) => get(routes.reservationProof(id), ProofResponse),

    startSession: (body) => post(routes.startSession(), ChargingSession, body),
    getSession: (id) => get(routes.session(id), ChargingSession),
    stopSession: (id) => post(routes.stopSession(id), ChargingSession),
    sessionEventsUrl: (id, wallet) =>
      `${baseUrl}${routes.sessionEvents(id)}?${WALLET_QUERY_PARAM}=${encodeURIComponent(wallet)}`,
  };
}
