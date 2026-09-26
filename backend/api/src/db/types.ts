import type {
  AccessType,
  ConnectorType,
  ReservationStatus,
  SessionStatus,
  SlotStatus,
} from "@chargemesh/shared";
import type { ObjectId } from "mongodb";

export interface NodeDocument {
  _id: string;
  hostAddress: string;
  name: string;
  areaLabel: string;
  addressLine: string;
  lat: number;
  lng: number;
  accessInstructions: string;
  connectorType: ConnectorType;
  maxPowerKw: number;
  accessType: AccessType;
  ocppChargePointId: string;
  ocppConnectorId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlotDocument {
  _id: string;
  nodeId: string;
  slotRef: string;
  startsAt: Date;
  endsAt: Date;
  maxEnergyWh: number;
  pricePerKwhWei: string;
  status: SlotStatus;
  heldUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntentDocument {
  _id: string;
  driverAddress: string;
  lat: number;
  lng: number;
  radiusKm: number;
  arriveAt: Date;
  departAt: Date;
  requestedWh: number;
  connectorType: ConnectorType;
  acceptedAccessTypes: AccessType[];
  createdAt: Date;
}

export interface ReservationDocument {
  _id: string;
  onchainId: string;
  intentId: string;
  slotId: string;
  driverAddress: string;
  hostAddress: string;
  status: ReservationStatus;
  requestedWh: number;
  pricePerKwhWei: string;
  depositWei: string;
  windowStartsAt: Date;
  windowEndsAt: Date;
  holdExpiresAt: Date;
  quoteSignature: string | null;
  reserveTxHash: string | null;
  startTxHash: string | null;
  settleTxHash: string | null;
  cancelTxHash: string | null;
  settledDeliveredWh: number | null;
  billableWh: number | null;
  hostAmountWei: string | null;
  refundWei: string | null;
  sessionHash: string | null;
  failureReason: string | null;
  retryCount: number;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDocument {
  _id: string;
  reservationId: string;
  status: SessionStatus;
  chargePointId: string;
  connectorId: number;
  ocppIdTag: string;
  ocppTransactionId: number | null;
  requestedWh: number;
  meterStartWh: number | null;
  latestMeterWh: number | null;
  meterStopWh: number | null;
  deliveredWh: number;
  powerW: number;
  startedAt: Date | null;
  stoppedAt: Date | null;
  stopReason: string | null;
  proofCanonicalJson: string | null;
  sessionHash: string | null;
  startTxHash: string | null;
  settleTxHash: string | null;
  stopRequested: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeterSampleDocument {
  _id?: ObjectId;
  sessionId: string;
  ocppTransactionId: number;
  sampledAt: Date;
  energyWh: number;
  powerW: number;
  raw: unknown;
  receivedAt: Date;
}

export interface OcppMessageDocument {
  _id?: ObjectId;
  chargePointId: string;
  direction: "IN" | "OUT";
  kind: "CALL" | "CALLRESULT" | "CALLERROR";
  messageId: string;
  action: string | null;
  payload: unknown;
  createdAt: Date;
}

export interface CounterDocument {
  _id: string;
  value: number;
}

export type ReservationPatch = Partial<Omit<ReservationDocument, "_id" | "createdAt">>;
export type SessionPatch = Partial<Omit<SessionDocument, "_id" | "createdAt">>;
