import type { Store, SlotClaimResult } from "./store";
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

const copy = <T>(value: T): T => structuredClone(value);

export class MemoryStore implements Store {
  private readonly nodes = new Map<string, NodeDocument>();
  private readonly slots = new Map<string, SlotDocument>();
  private readonly intents = new Map<string, IntentDocument>();
  private readonly reservations = new Map<string, ReservationDocument>();
  private readonly sessions = new Map<string, SessionDocument>();
  private readonly meterSamples: MeterSampleDocument[] = [];
  private readonly ocppMessages: OcppMessageDocument[] = [];
  private transactionId = 0;

  async createNode(document: NodeDocument): Promise<NodeDocument> {
    if ([...this.nodes.values()].some((node) => node.ocppChargePointId === document.ocppChargePointId)) {
      throw new Error(`Duplicate ocppChargePointId ${document.ocppChargePointId}`);
    }
    this.nodes.set(document._id, copy(document));
    return copy(document);
  }

  async findNode(id: string): Promise<NodeDocument | null> {
    return copy(this.nodes.get(id) ?? null);
  }

  async findNodeByChargePoint(chargePointId: string): Promise<NodeDocument | null> {
    return copy([...this.nodes.values()].find((node) => node.ocppChargePointId === chargePointId) ?? null);
  }

  async listNodesByHost(hostAddress: string): Promise<NodeDocument[]> {
    return copy(
      [...this.nodes.values()]
        .filter((node) => node.hostAddress === hostAddress)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  async createSlot(document: SlotDocument): Promise<SlotDocument> {
    this.slots.set(document._id, copy(document));
    return copy(document);
  }

  async findSlot(id: string): Promise<SlotDocument | null> {
    return copy(this.slots.get(id) ?? null);
  }

  async listSlotsByNode(nodeId: string): Promise<SlotDocument[]> {
    return copy(
      [...this.slots.values()]
        .filter((slot) => slot.nodeId === nodeId)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }

  async listMatchableSlots(now: Date): Promise<SlotDocument[]> {
    return copy(
      [...this.slots.values()].filter(
        (slot) => slot.status === "OPEN" || (slot.status === "HELD" && !!slot.heldUntil && slot.heldUntil <= now),
      ),
    );
  }

  async closeSlot(id: string, nodeId: string, now: Date): Promise<SlotDocument | null> {
    const slot = this.slots.get(id);
    if (!slot || slot.nodeId !== nodeId || slot.status !== "OPEN") return null;
    const updated = { ...slot, status: "CLOSED" as const, updatedAt: now };
    this.slots.set(id, updated);
    return copy(updated);
  }

  async claimSlotAndCreateReservation(
    slotId: string,
    reservation: ReservationDocument,
    now: Date,
  ): Promise<SlotClaimResult> {
    const slot = this.slots.get(slotId);
    const available =
      slot?.status === "OPEN" ||
      (slot?.status === "HELD" && slot.heldUntil !== null && slot.heldUntil <= now);
    if (!slot || !available) return "unavailable";
    this.slots.set(slotId, {
      ...slot,
      status: "HELD",
      heldUntil: reservation.holdExpiresAt,
      updatedAt: now,
    });
    this.reservations.set(reservation._id, copy(reservation));
    return "claimed";
  }

  async releaseExpiredHolds(now: Date): Promise<number> {
    let released = 0;
    for (const [id, slot] of this.slots) {
      if (slot.status === "HELD" && slot.heldUntil !== null && slot.heldUntil <= now) {
        this.slots.set(id, { ...slot, status: "OPEN", heldUntil: null, updatedAt: now });
        released++;
      }
    }
    for (const [id, reservation] of this.reservations) {
      if (reservation.status === "PENDING_PAYMENT" && reservation.holdExpiresAt <= now) {
        this.reservations.set(id, { ...reservation, status: "HOLD_EXPIRED", updatedAt: now });
      }
    }
    return released;
  }

  async createIntent(document: IntentDocument): Promise<IntentDocument> {
    this.intents.set(document._id, copy(document));
    return copy(document);
  }

  async findIntent(id: string): Promise<IntentDocument | null> {
    return copy(this.intents.get(id) ?? null);
  }

  async findReservation(id: string): Promise<ReservationDocument | null> {
    return copy(this.reservations.get(id) ?? null);
  }

  async findReservationByOnchainId(onchainId: string): Promise<ReservationDocument | null> {
    return copy(
      [...this.reservations.values()].find(
        (reservation) => reservation.onchainId.toLowerCase() === onchainId.toLowerCase(),
      ) ?? null,
    );
  }

  async updateReservation(id: string, patch: ReservationPatch): Promise<ReservationDocument | null> {
    const reservation = this.reservations.get(id);
    if (!reservation) return null;
    const updated = { ...reservation, ...copy(patch) };
    this.reservations.set(id, updated);
    return copy(updated);
  }

  async confirmReservation(id: string, txHash: string, now: Date): Promise<ReservationDocument | null> {
    const reservation = this.reservations.get(id);
    if (!reservation) return null;
    if (reservation.status === "CONFIRMED" && reservation.reserveTxHash === txHash) return copy(reservation);
    if (reservation.status !== "PENDING_PAYMENT") return null;
    const slot = this.slots.get(reservation.slotId);
    if (!slot || slot.status !== "HELD") return null;
    this.slots.set(slot._id, { ...slot, status: "RESERVED", heldUntil: null, updatedAt: now });
    const updated = { ...reservation, status: "CONFIRMED" as const, reserveTxHash: txHash, updatedAt: now };
    this.reservations.set(id, updated);
    return copy(updated);
  }

  async syncReservationState(
    id: string,
    patch: ReservationPatch,
    reopenSlot: boolean,
    now: Date,
  ): Promise<ReservationDocument | null> {
    const updated = await this.updateReservation(id, { ...patch, updatedAt: now });
    if (!updated) return null;
    if (reopenSlot) {
      const slot = this.slots.get(updated.slotId);
      if (slot) this.slots.set(slot._id, { ...slot, status: "OPEN", heldUntil: null, updatedAt: now });
    } else if (["CONFIRMED", "ACTIVE", "COMPLETED", "SETTLED"].includes(updated.status)) {
      const slot = this.slots.get(updated.slotId);
      if (slot && (slot.status === "OPEN" || slot.status === "HELD")) {
        this.slots.set(slot._id, { ...slot, status: "RESERVED", heldUntil: null, updatedAt: now });
      }
    }
    return copy(updated);
  }

  async listReservationsByWallet(wallet: string, role: "driver" | "host"): Promise<ReservationDocument[]> {
    const field = role === "driver" ? "driverAddress" : "hostAddress";
    return copy(
      [...this.reservations.values()]
        .filter((reservation) => reservation[field] === wallet)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  async listReservationsByNode(nodeId: string): Promise<ReservationDocument[]> {
    const slotIds = new Set([...this.slots.values()].filter((slot) => slot.nodeId === nodeId).map((slot) => slot._id));
    return copy(
      [...this.reservations.values()]
        .filter((reservation) => slotIds.has(reservation.slotId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  async createSession(document: SessionDocument): Promise<SessionDocument> {
    if ([...this.sessions.values()].some((session) => session.reservationId === document.reservationId)) {
      throw new Error(`Duplicate session reservationId ${document.reservationId}`);
    }
    this.sessions.set(document._id, copy(document));
    return copy(document);
  }

  async findSession(id: string): Promise<SessionDocument | null> {
    return copy(this.sessions.get(id) ?? null);
  }

  async findSessionByReservation(reservationId: string): Promise<SessionDocument | null> {
    return copy([...this.sessions.values()].find((session) => session.reservationId === reservationId) ?? null);
  }

  async findSessionByIdTag(idTag: string): Promise<SessionDocument | null> {
    return copy([...this.sessions.values()].find((session) => session.ocppIdTag === idTag) ?? null);
  }

  async findSessionByTransaction(transactionId: number): Promise<SessionDocument | null> {
    return copy(
      [...this.sessions.values()].find((session) => session.ocppTransactionId === transactionId) ?? null,
    );
  }

  async updateSession(id: string, patch: SessionPatch): Promise<SessionDocument | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    const updated = { ...session, ...copy(patch) };
    this.sessions.set(id, updated);
    return copy(updated);
  }

  async nextOcppTransactionId(): Promise<number> {
    this.transactionId++;
    return this.transactionId;
  }

  async insertMeterSample(document: MeterSampleDocument): Promise<void> {
    this.meterSamples.push(copy(document));
  }

  async listMeterSamples(sessionId: string): Promise<MeterSampleDocument[]> {
    return copy(
      this.meterSamples
        .filter((sample) => sample.sessionId === sessionId)
        .sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime()),
    );
  }

  async insertOcppMessage(document: OcppMessageDocument): Promise<void> {
    this.ocppMessages.push(copy(document));
  }

  async ensureIndexes(): Promise<void> {}

  async close(): Promise<void> {}
}
