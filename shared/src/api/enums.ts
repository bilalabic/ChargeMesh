import { z } from "zod";

export const ConnectorType = z.enum(["TYPE2", "TYPE1"]);
export type ConnectorType = z.infer<typeof ConnectorType>;

export const AccessType = z.enum(["OPEN_PARKING", "GATED_PARKING", "BUILDING_GARAGE"]);
export type AccessType = z.infer<typeof AccessType>;
export const ALL_ACCESS_TYPES: readonly AccessType[] = AccessType.options;

export const SlotStatus = z.enum(["OPEN", "HELD", "RESERVED", "CLOSED"]);
export type SlotStatus = z.infer<typeof SlotStatus>;

export const ReservationStatus = z.enum([
  "PENDING_PAYMENT",
  "HOLD_EXPIRED",
  "CONFIRMED",
  "ACTIVE",
  "COMPLETED",
  "SETTLED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
]);
export type ReservationStatus = z.infer<typeof ReservationStatus>;

export const SessionStatus = z.enum([
  "STARTING",
  "CHARGING",
  "STOPPING",
  "COMPLETED",
  "SETTLING",
  "SETTLED",
  "FAILED",
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const ChainMode = z.enum(["mock", "anvil", "monad"]);
export type ChainMode = z.infer<typeof ChainMode>;

export const ApiErrorCode = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SLOT_UNAVAILABLE",
  "INVALID_STATE",
  "CHARGER_OFFLINE",
  "OUTSIDE_TIME_WINDOW",
  "AMBIGUOUS_RESERVATION",
  "CHAIN_VERIFICATION_FAILED",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const API_ERROR_HTTP_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  INVALID_STATE: 409,
  CHARGER_OFFLINE: 409,
  OUTSIDE_TIME_WINDOW: 409,
  AMBIGUOUS_RESERVATION: 409,
  CHAIN_VERIFICATION_FAILED: 422,
  INTERNAL: 500,
};
