import type {
  ApiErrorCode,
  AppConfig,
  ChargeIntent,
  ChargerStatus,
  ChargingNode,
  ChargingSession,
  ConfirmReservationRequest,
  CreateIntentRequest,
  CreateNodeRequest,
  CreateReservationRequest,
  CreateReservationResponse,
  CreateSlotRequest,
  EnergySlot,
  ListReservationsQuery,
  MatchesResponse,
  ProofResponse,
  PublicChargingNode,
  Reservation,
  StartSessionRequest,
  SyncReservationRequest,
} from "@chargemesh/shared";

/**
 * Single API surface used by every component (docs/03-api.md).
 * Implemented by `live.ts`; every request goes to the Fastify backend.
 */
export interface ApiClient {
  // ---------- System ----------
  config(): Promise<AppConfig>;
  chargers(): Promise<ChargerStatus[]>;

  // ---------- Host ----------
  createNode(body: CreateNodeRequest): Promise<ChargingNode>;
  listMyNodes(): Promise<ChargingNode[]>;
  /** Full view for the owner, public view for everyone else. */
  getNode(nodeId: string): Promise<ChargingNode | PublicChargingNode>;
  createSlot(nodeId: string, body: CreateSlotRequest): Promise<EnergySlot>;
  listSlots(nodeId: string): Promise<EnergySlot[]>;
  closeSlot(slotId: string): Promise<EnergySlot>;
  listNodeReservations(nodeId: string): Promise<Reservation[]>;

  // ---------- Driver ----------
  createIntent(body: CreateIntentRequest): Promise<ChargeIntent>;
  getIntent(intentId: string): Promise<ChargeIntent>;
  getMatches(intentId: string): Promise<MatchesResponse>;
  createReservation(body: CreateReservationRequest): Promise<CreateReservationResponse>;
  confirmReservation(id: string, body: ConfirmReservationRequest): Promise<Reservation>;
  syncReservation(id: string, body?: SyncReservationRequest): Promise<Reservation>;
  listReservations(role: ListReservationsQuery["role"]): Promise<Reservation[]>;
  getReservation(id: string): Promise<Reservation>;
  getProof(id: string): Promise<ProofResponse>;

  // ---------- Sessions ----------
  startSession(body: StartSessionRequest): Promise<ChargingSession>;
  getSession(id: string): Promise<ChargingSession>;
  stopSession(id: string): Promise<ChargingSession>;
  /** SSE endpoint for the live Fastify event stream. */
  sessionEventsUrl(id: string, wallet: string): string;
}

/** Error thrown by every ApiClient method; mirrors the API error body. */
export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, status: number, details: unknown = null) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Supplies the connected wallet address (or null) for the `x-wallet-address` header. */
export type WalletGetter = () => string | null | undefined;
