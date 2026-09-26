import type {
  IntentDocument,
  MeterSampleDocument,
  NodeDocument,
  OcppMessageDocument,
  ReservationDocument,
  ReservationPatch,
  SessionDocument,
  SessionPatch,
  SlotDocument,
} from "./types";

export type SlotClaimResult = "claimed" | "unavailable";

export interface Store {
  createNode(document: NodeDocument): Promise<NodeDocument>;
  findNode(id: string): Promise<NodeDocument | null>;
  findNodeByChargePoint(chargePointId: string): Promise<NodeDocument | null>;
  listNodesByHost(hostAddress: string): Promise<NodeDocument[]>;

  createSlot(document: SlotDocument): Promise<SlotDocument>;
  findSlot(id: string): Promise<SlotDocument | null>;
  listSlotsByNode(nodeId: string): Promise<SlotDocument[]>;
  listMatchableSlots(now: Date): Promise<SlotDocument[]>;
  closeSlot(id: string, nodeId: string, now: Date): Promise<SlotDocument | null>;
  claimSlotAndCreateReservation(
    slotId: string,
    reservation: ReservationDocument,
    now: Date,
  ): Promise<SlotClaimResult>;
  releaseExpiredHolds(now: Date): Promise<number>;

  createIntent(document: IntentDocument): Promise<IntentDocument>;
  findIntent(id: string): Promise<IntentDocument | null>;

  findReservation(id: string): Promise<ReservationDocument | null>;
  findReservationByOnchainId(onchainId: string): Promise<ReservationDocument | null>;
  updateReservation(id: string, patch: ReservationPatch): Promise<ReservationDocument | null>;
  confirmReservation(id: string, txHash: string, now: Date): Promise<ReservationDocument | null>;
  syncReservationState(
    id: string,
    patch: ReservationPatch,
    reopenSlot: boolean,
    now: Date,
  ): Promise<ReservationDocument | null>;
  listReservationsByWallet(wallet: string, role: "driver" | "host"): Promise<ReservationDocument[]>;
  listReservationsByNode(nodeId: string): Promise<ReservationDocument[]>;

  createSession(document: SessionDocument): Promise<SessionDocument>;
  findSession(id: string): Promise<SessionDocument | null>;
  findSessionByReservation(reservationId: string): Promise<SessionDocument | null>;
  findSessionByIdTag(idTag: string): Promise<SessionDocument | null>;
  findSessionByTransaction(transactionId: number): Promise<SessionDocument | null>;
  updateSession(id: string, patch: SessionPatch): Promise<SessionDocument | null>;
  nextOcppTransactionId(): Promise<number>;

  insertMeterSample(document: MeterSampleDocument): Promise<void>;
  listMeterSamples(sessionId: string): Promise<MeterSampleDocument[]>;
  insertOcppMessage(document: OcppMessageDocument): Promise<void>;

  ensureIndexes(): Promise<void>;
  close(): Promise<void>;
}
