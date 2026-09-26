/** Route table for REST API v1 (docs/03-api.md). Paths are relative to API_PREFIX. */
export const API_PREFIX = "/api/v1";
export const WALLET_HEADER = "x-wallet-address";
export const WALLET_QUERY_PARAM = "wallet";

export const routes = {
  config: () => "/config",
  chargers: () => "/chargers",
  demoSeed: () => "/demo/seed",

  nodes: () => "/nodes",
  node: (nodeId: string) => `/nodes/${nodeId}`,
  nodeSlots: (nodeId: string) => `/nodes/${nodeId}/slots`,
  nodeReservations: (nodeId: string) => `/nodes/${nodeId}/reservations`,
  closeSlot: (slotId: string) => `/slots/${slotId}/close`,

  intents: () => "/intents",
  intent: (intentId: string) => `/intents/${intentId}`,
  intentMatches: (intentId: string) => `/intents/${intentId}/matches`,

  reservations: () => "/reservations",
  reservation: (id: string) => `/reservations/${id}`,
  confirmReservation: (id: string) => `/reservations/${id}/confirm`,
  syncReservation: (id: string) => `/reservations/${id}/sync`,
  reservationProof: (id: string) => `/reservations/${id}/proof`,

  startSession: () => "/sessions/start",
  session: (id: string) => `/sessions/${id}`,
  stopSession: (id: string) => `/sessions/${id}/stop`,
  sessionEvents: (id: string) => `/sessions/${id}/events`,
} as const;
