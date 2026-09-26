import {
  MongoClient,
  ReadPreference,
  ServerApiVersion,
  type Collection,
  type Db,
  type Filter,
} from "mongodb";
import { ensureMongoIndexes } from "./indexes";
import type { Store, SlotClaimResult } from "./store";
import type {
  CounterDocument,
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

const transactionOptions = {
  readPreference: ReadPreference.primary,
  readConcern: { level: "snapshot" as const },
  writeConcern: { w: "majority" as const },
  maxCommitTimeMS: 10_000,
};

export class MongoStore implements Store {
  private readonly client: MongoClient;
  private readonly db: Db;

  constructor(uri: string, databaseName: string) {
    this.client = new MongoClient(uri, {
      appName: "chargemesh-api",
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    this.db = this.client.db(databaseName);
  }

  private collection<T extends { _id?: unknown }>(name: string): Collection<T> {
    return this.db.collection<T>(name);
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.db.command({ ping: 1 });
  }

  async createNode(document: NodeDocument): Promise<NodeDocument> {
    await this.collection<NodeDocument>("nodes").insertOne(document);
    return document;
  }

  async findNode(id: string): Promise<NodeDocument | null> {
    return this.collection<NodeDocument>("nodes").findOne({ _id: id });
  }

  async findNodeByChargePoint(chargePointId: string): Promise<NodeDocument | null> {
    return this.collection<NodeDocument>("nodes").findOne({ ocppChargePointId: chargePointId });
  }

  async listNodesByHost(hostAddress: string): Promise<NodeDocument[]> {
    return this.collection<NodeDocument>("nodes").find({ hostAddress }).sort({ createdAt: -1 }).toArray();
  }

  async createSlot(document: SlotDocument): Promise<SlotDocument> {
    await this.collection<SlotDocument>("slots").insertOne(document);
    return document;
  }

  async findSlot(id: string): Promise<SlotDocument | null> {
    return this.collection<SlotDocument>("slots").findOne({ _id: id });
  }

  async listSlotsByNode(nodeId: string): Promise<SlotDocument[]> {
    return this.collection<SlotDocument>("slots").find({ nodeId }).sort({ startsAt: 1 }).toArray();
  }

  async listMatchableSlots(now: Date): Promise<SlotDocument[]> {
    return this.collection<SlotDocument>("slots")
      .find({ $or: [{ status: "OPEN" }, { status: "HELD", heldUntil: { $lte: now } }] })
      .toArray();
  }

  async closeSlot(id: string, nodeId: string, now: Date): Promise<SlotDocument | null> {
    return this.collection<SlotDocument>("slots").findOneAndUpdate(
      { _id: id, nodeId, status: "OPEN" },
      { $set: { status: "CLOSED", updatedAt: now } },
      { returnDocument: "after" },
    );
  }

  async claimSlotAndCreateReservation(
    slotId: string,
    reservation: ReservationDocument,
    now: Date,
  ): Promise<SlotClaimResult> {
    const session = this.client.startSession();
    let result: SlotClaimResult = "unavailable";
    try {
      await session.withTransaction(async () => {
        const filter: Filter<SlotDocument> = {
          _id: slotId,
          $or: [{ status: "OPEN" }, { status: "HELD", heldUntil: { $lte: now } }],
        };
        const slot = await this.collection<SlotDocument>("slots").findOneAndUpdate(
          filter,
          { $set: { status: "HELD", heldUntil: reservation.holdExpiresAt, updatedAt: now } },
          { session, returnDocument: "after" },
        );
        if (!slot) return;
        await this.collection<ReservationDocument>("reservations").insertOne(reservation, { session });
        result = "claimed";
      }, transactionOptions);
      return result;
    } finally {
      await session.endSession();
    }
  }

  async releaseExpiredHolds(now: Date): Promise<number> {
    const session = this.client.startSession();
    let released = 0;
    try {
      await session.withTransaction(async () => {
        const slots = await this.collection<SlotDocument>("slots").updateMany(
          { status: "HELD", heldUntil: { $lte: now } },
          { $set: { status: "OPEN", heldUntil: null, updatedAt: now } },
          { session },
        );
        released = slots.modifiedCount;
        await this.collection<ReservationDocument>("reservations").updateMany(
          { status: "PENDING_PAYMENT", holdExpiresAt: { $lte: now } },
          { $set: { status: "HOLD_EXPIRED", updatedAt: now } },
          { session },
        );
      }, transactionOptions);
      return released;
    } finally {
      await session.endSession();
    }
  }

  async createIntent(document: IntentDocument): Promise<IntentDocument> {
    await this.collection<IntentDocument>("intents").insertOne(document);
    return document;
  }

  async findIntent(id: string): Promise<IntentDocument | null> {
    return this.collection<IntentDocument>("intents").findOne({ _id: id });
  }

  async findReservation(id: string): Promise<ReservationDocument | null> {
    return this.collection<ReservationDocument>("reservations").findOne({ _id: id });
  }

  async findReservationByOnchainId(onchainId: string): Promise<ReservationDocument | null> {
    return this.collection<ReservationDocument>("reservations").findOne({ onchainId });
  }

  async updateReservation(id: string, patch: ReservationPatch): Promise<ReservationDocument | null> {
    return this.collection<ReservationDocument>("reservations").findOneAndUpdate(
      { _id: id },
      { $set: patch },
      { returnDocument: "after" },
    );
  }

  async confirmReservation(id: string, txHash: string, now: Date): Promise<ReservationDocument | null> {
    const session = this.client.startSession();
    let result: ReservationDocument | null = null;
    try {
      await session.withTransaction(async () => {
        const reservation = await this.collection<ReservationDocument>("reservations").findOne(
          { _id: id },
          { session },
        );
        if (!reservation) return;
        if (reservation.status === "CONFIRMED" && reservation.reserveTxHash === txHash) {
          result = reservation;
          return;
        }
        if (reservation.status !== "PENDING_PAYMENT") return;
        const slot = await this.collection<SlotDocument>("slots").findOneAndUpdate(
          { _id: reservation.slotId, status: "HELD" },
          { $set: { status: "RESERVED", heldUntil: null, updatedAt: now } },
          { session, returnDocument: "after" },
        );
        if (!slot) return;
        result = await this.collection<ReservationDocument>("reservations").findOneAndUpdate(
          { _id: id, status: "PENDING_PAYMENT" },
          { $set: { status: "CONFIRMED", reserveTxHash: txHash, updatedAt: now } },
          { session, returnDocument: "after" },
        );
      }, transactionOptions);
      return result;
    } finally {
      await session.endSession();
    }
  }

  async syncReservationState(
    id: string,
    patch: ReservationPatch,
    reopenSlot: boolean,
    now: Date,
  ): Promise<ReservationDocument | null> {
    const session = this.client.startSession();
    let result: ReservationDocument | null = null;
    try {
      await session.withTransaction(async () => {
        result = await this.collection<ReservationDocument>("reservations").findOneAndUpdate(
          { _id: id },
          { $set: { ...patch, updatedAt: now } },
          { session, returnDocument: "after" },
        );
        if (reopenSlot && result) {
          await this.collection<SlotDocument>("slots").updateOne(
            { _id: result.slotId },
            { $set: { status: "OPEN", heldUntil: null, updatedAt: now } },
            { session },
          );
        } else if (result && ["CONFIRMED", "ACTIVE", "COMPLETED", "SETTLED"].includes(result.status)) {
          await this.collection<SlotDocument>("slots").updateOne(
            { _id: result.slotId, status: { $in: ["OPEN", "HELD"] } },
            { $set: { status: "RESERVED", heldUntil: null, updatedAt: now } },
            { session },
          );
        }
      }, transactionOptions);
      return result;
    } finally {
      await session.endSession();
    }
  }

  async listReservationsByWallet(wallet: string, role: "driver" | "host"): Promise<ReservationDocument[]> {
    const filter = role === "driver" ? { driverAddress: wallet } : { hostAddress: wallet };
    return this.collection<ReservationDocument>("reservations").find(filter).sort({ createdAt: -1 }).toArray();
  }

  async listReservationsByNode(nodeId: string): Promise<ReservationDocument[]> {
    const slots = await this.collection<SlotDocument>("slots").find({ nodeId }).project({ _id: 1 }).toArray();
    return this.collection<ReservationDocument>("reservations")
      .find({ slotId: { $in: slots.map((slot) => slot._id) } })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async createSession(document: SessionDocument): Promise<SessionDocument> {
    await this.collection<SessionDocument>("sessions").insertOne(document);
    return document;
  }

  async findSession(id: string): Promise<SessionDocument | null> {
    return this.collection<SessionDocument>("sessions").findOne({ _id: id });
  }

  async findSessionByReservation(reservationId: string): Promise<SessionDocument | null> {
    return this.collection<SessionDocument>("sessions").findOne({ reservationId });
  }

  async findSessionByIdTag(idTag: string): Promise<SessionDocument | null> {
    return this.collection<SessionDocument>("sessions").findOne({ ocppIdTag: idTag });
  }

  async findSessionByTransaction(transactionId: number): Promise<SessionDocument | null> {
    return this.collection<SessionDocument>("sessions").findOne({ ocppTransactionId: transactionId });
  }

  async updateSession(id: string, patch: SessionPatch): Promise<SessionDocument | null> {
    return this.collection<SessionDocument>("sessions").findOneAndUpdate(
      { _id: id },
      { $set: patch },
      { returnDocument: "after" },
    );
  }

  async nextOcppTransactionId(): Promise<number> {
    const counter = await this.collection<CounterDocument>("counters").findOneAndUpdate(
      { _id: "ocppTransactionId" },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    if (!counter) throw new Error("Failed to allocate OCPP transaction id");
    return counter.value;
  }

  async insertMeterSample(document: MeterSampleDocument): Promise<void> {
    await this.collection<MeterSampleDocument>("meterSamples").insertOne(document);
  }

  async listMeterSamples(sessionId: string): Promise<MeterSampleDocument[]> {
    return this.collection<MeterSampleDocument>("meterSamples").find({ sessionId }).sort({ sampledAt: 1 }).toArray();
  }

  async insertOcppMessage(document: OcppMessageDocument): Promise<void> {
    await this.collection<OcppMessageDocument>("ocppMessages").insertOne(document);
  }

  async ensureIndexes(): Promise<void> {
    await ensureMongoIndexes(this.db);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
