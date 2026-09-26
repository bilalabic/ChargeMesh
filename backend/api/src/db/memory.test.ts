import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory";
import type { ReservationDocument, SlotDocument } from "./types";

const now = new Date("2026-10-03T08:00:00.000Z");

function slot(overrides: Partial<SlotDocument> = {}): SlotDocument {
  return {
    _id: "0b7c0e1a-2d3f-4a5b-8c9d-0e1f2a3b4c5d",
    nodeId: "6f1c2a9b-0d4e-4f81-a2b3-c4d5e6f70811",
    slotRef: `0x${"11".repeat(32)}`,
    startsAt: new Date("2026-10-03T08:00:00.000Z"),
    endsAt: new Date("2026-10-03T12:00:00.000Z"),
    maxEnergyWh: 40_000,
    pricePerKwhWei: "10000000000000000",
    status: "OPEN",
    heldUntil: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function reservation(id: string): ReservationDocument {
  return {
    _id: id,
    onchainId: `0x${"22".repeat(32)}`,
    intentId: "6f1c2a9b-0d4e-4f81-a2b3-c4d5e6f70813",
    slotId: "0b7c0e1a-2d3f-4a5b-8c9d-0e1f2a3b4c5d",
    driverAddress: `0x${"33".repeat(20)}`,
    hostAddress: `0x${"44".repeat(20)}`,
    status: "PENDING_PAYMENT",
    requestedWh: 20_000,
    pricePerKwhWei: "10000000000000000",
    depositWei: "200000000000000000",
    windowStartsAt: new Date("2026-10-03T08:00:00.000Z"),
    windowEndsAt: new Date("2026-10-03T12:00:00.000Z"),
    holdExpiresAt: new Date("2026-10-03T08:05:00.000Z"),
    quoteSignature: null,
    reserveTxHash: null,
    startTxHash: null,
    settleTxHash: null,
    cancelTxHash: null,
    settledDeliveredWh: null,
    billableWh: null,
    hostAmountWei: null,
    refundWei: null,
    sessionHash: null,
    failureReason: null,
    retryCount: 0,
    nextRetryAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("MemoryStore", () => {
  it("claims a slot once and creates the reservation atomically", async () => {
    const store = new MemoryStore();
    await store.createSlot(slot());

    expect(await store.claimSlotAndCreateReservation(slot()._id, reservation("r-1"), now)).toBe("claimed");
    expect(await store.claimSlotAndCreateReservation(slot()._id, reservation("r-2"), now)).toBe("unavailable");
    expect((await store.findSlot(slot()._id))?.status).toBe("HELD");
    expect((await store.findReservation("r-1"))?.status).toBe("PENDING_PAYMENT");
    expect(await store.findReservation("r-2")).toBeNull();
  });

  it("releases expired holds and marks pending reservations expired", async () => {
    const store = new MemoryStore();
    const expiredAt = new Date("2026-10-03T07:59:00.000Z");
    await store.createSlot(slot());
    const pending = reservation("r-expired");
    pending.holdExpiresAt = expiredAt;
    await store.claimSlotAndCreateReservation(
      slot()._id,
      pending,
      new Date("2026-10-03T07:58:00.000Z"),
    );

    expect(await store.releaseExpiredHolds(now)).toBe(1);
    expect((await store.findSlot(slot()._id))?.status).toBe("OPEN");
    expect((await store.findReservation("r-expired"))?.status).toBe("HOLD_EXPIRED");
  });

  it("allocates increasing OCPP transaction ids", async () => {
    const store = new MemoryStore();
    expect(await store.nextOcppTransactionId()).toBe(1);
    expect(await store.nextOcppTransactionId()).toBe(2);
  });
});
