import { DEMO_CHARGE_POINT_ID, DEMO_IDS, createDemoFixtures } from "@chargemesh/shared/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./client";
import { createMockApiClient } from "./mock";

const TX_HASH = `0x${"12".repeat(32)}`;

describe("mock ApiClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T07:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const createDemoIntent = async (api: ReturnType<typeof createMockApiClient>) => {
    const { intent } = createDemoFixtures();
    return api.createIntent({
      lat: intent.lat,
      lng: intent.lng,
      radiusKm: intent.radiusKm,
      arriveAt: intent.arriveAt,
      departAt: intent.departAt,
      requestedWh: intent.requestedWh,
      connectorType: intent.connectorType,
    });
  };

  it("returns the demo slot as the top match with a 0.2 MON deposit", async () => {
    const api = createMockApiClient();
    const intent = await createDemoIntent(api);
    const { matches } = await api.getMatches(intent.id);

    expect(matches[0]).toMatchObject({
      rank: 1,
      slotId: DEMO_IDS.slot,
      fullyCovers: true,
      quotedWh: 20000,
      depositWei: "200000000000000000",
    });
  });

  it("runs reservation -> session -> proof and yields a verified proof", async () => {
    const api = createMockApiClient({ tickMs: 1000, whPerTick: 5000 });
    const intent = await createDemoIntent(api);
    const { matches } = await api.getMatches(intent.id);
    const match = matches[0]!;

    const created = await api.createReservation({ intentId: intent.id, slotId: match.slotId });
    expect(created.reservation.status).toBe("PENDING_PAYMENT");
    expect(created.quote.depositWei).toBe("200000000000000000");

    const confirmed = await api.confirmReservation(created.reservation.id, { txHash: TX_HASH });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.access).not.toBeNull();

    // The slot is no longer offered once reserved.
    expect((await api.getMatches(intent.id)).matches).toHaveLength(0);

    // Proof is not available before settlement.
    await expect(api.getProof(created.reservation.id)).rejects.toBeInstanceOf(ApiRequestError);

    const session = await api.startSession({
      chargePointId: DEMO_CHARGE_POINT_ID,
      connectorId: 1,
      reservationId: created.reservation.id,
    });
    expect(session.status).toBe("STARTING");

    await vi.advanceTimersByTimeAsync(1000);
    expect((await api.getSession(session.id)).status).toBe("CHARGING");

    // 4 ticks of 5 kWh reach the 20 kWh target, then COMPLETED, then SETTLED.
    await vi.advanceTimersByTimeAsync(6000);
    const finished = await api.getSession(session.id);
    expect(finished.status).toBe("SETTLED");
    expect(finished.deliveredWh).toBe(20000);

    const reservation = await api.getReservation(created.reservation.id);
    expect(reservation.status).toBe("SETTLED");
    expect(reservation.settlement).toMatchObject({
      billableWh: 20000,
      hostAmountWei: "200000000000000000",
      refundWei: "0",
    });

    const proof = await api.getProof(created.reservation.id);
    expect(proof.verified).toBe(true);
    expect(proof.onchain?.sessionHash).toBe(proof.sessionHash);
    expect(proof.summary.deliveredWh).toBe(20000);
  });
});
