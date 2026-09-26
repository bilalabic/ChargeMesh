import { randomUUID } from "node:crypto";
import { MongoClient, ServerApiVersion } from "mongodb";
import { describe, expect, it } from "vitest";
import { MongoStore } from "./mongo";
import type { NodeDocument, ReservationDocument, SlotDocument } from "./types";

const uri = process.env.MONGODB_TEST_URI;
const PREFIX = "chargemesh_smoke_";

async function dropSmokeDatabase(connectionUri: string, databaseName: string): Promise<void> {
  if (!databaseName.startsWith(PREFIX)) {
    throw new Error("Refusing to drop a database without the smoke-test prefix");
  }
  const cleanup = new MongoClient(connectionUri, {
    appName: "chargemesh-atlas-smoke-cleanup",
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  });
  try {
    await cleanup.connect();
    await cleanup.db(databaseName).dropDatabase();
  } finally {
    await cleanup.close();
  }
}

describe.skipIf(!uri)("MongoDB Atlas smoke", () => {
  it("connects, prepares indexes and performs an atomic slot claim", async () => {
    if (!uri) throw new Error("MONGODB_TEST_URI is required for the Atlas smoke test");
    const databaseName = `${PREFIX}${randomUUID().replaceAll("-", "")}`;
    const store = new MongoStore(uri, databaseName);
    const now = new Date();
    const node: NodeDocument = {
      _id: randomUUID(),
      hostAddress: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
      name: "Atlas Smoke Node",
      areaLabel: "Test, İstanbul",
      addressLine: "Atlas smoke test address",
      lat: 40.98,
      lng: 29.02,
      accessInstructions: "",
      connectorType: "TYPE2",
      maxPowerKw: 7.4,
      accessType: "OPEN_PARKING",
      ocppChargePointId: `CM-SMOKE-${randomUUID().slice(0, 8)}`,
      ocppConnectorId: 1,
      createdAt: now,
      updatedAt: now,
    };
    const slotId = randomUUID();
    const slot: SlotDocument = {
      _id: slotId,
      nodeId: node._id,
      slotRef: `0x${"ab".repeat(32)}`,
      startsAt: now,
      endsAt: new Date(now.getTime() + 60 * 60_000),
      maxEnergyWh: 20_000,
      pricePerKwhWei: "10000000000000000",
      status: "OPEN",
      heldUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    const reservation: ReservationDocument = {
      _id: randomUUID(),
      onchainId: `0x${"cd".repeat(32)}`,
      intentId: randomUUID(),
      slotId,
      driverAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      hostAddress: node.hostAddress,
      status: "PENDING_PAYMENT",
      requestedWh: 20_000,
      pricePerKwhWei: slot.pricePerKwhWei,
      depositWei: "200000000000000000",
      windowStartsAt: slot.startsAt,
      windowEndsAt: slot.endsAt,
      holdExpiresAt: new Date(now.getTime() + 5 * 60_000),
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

    try {
      await store.connect();
      await store.ensureIndexes();
      await store.createNode(node);
      await store.createSlot(slot);
      expect(await store.claimSlotAndCreateReservation(slotId, reservation, now)).toBe("claimed");
      expect((await store.findReservation(reservation._id))?.status).toBe("PENDING_PAYMENT");
      expect((await store.findSlot(slotId))?.status).toBe("HELD");
    } finally {
      await store.close().catch(() => undefined);
      await dropSmokeDatabase(uri, databaseName);
    }
  }, 30_000);
});
