/**
 * In-memory ApiClient for NEXT_PUBLIC_API_MODE=mock. Seeded from createDemoFixtures()
 * and ranked with rankMatches(), so the demo flow (docs/06-demo-senaryosu.md) runs in the
 * browser without the API or a chain. Charging is simulated with timers.
 */
import {
  API_ERROR_HTTP_STATUS,
  ChargeIntent,
  ChargingNode,
  ChargingSession,
  CreateIntentRequest,
  CreateNodeRequest,
  CreateReservationResponse,
  CreateSlotRequest,
  EnergySlot,
  Hex32,
  MatchesResponse,
  PROOF_VERSION,
  ProofResponse,
  PublicChargingNode,
  Reservation,
  computeSamplesHash,
  computeSessionHash,
  computeSettlement,
  canonicalize,
  normalizeAddress,
  rankMatches,
  toOnchainReservationId,
  toSlotRef,
  type ApiErrorCode,
  type AppConfig,
  type ChargerStatus,
  type MatchCandidate,
  type MeterSampleForHash,
  type ProofOfChargeSummary,
  type ReservationQuote,
} from "@chargemesh/shared";
import {
  DEMO_CONTRACT_ADDRESS,
  DEMO_DRIVER_ADDRESS,
  DEMO_HOST_ADDRESS,
  createDemoFixtures,
} from "@chargemesh/shared/fixtures";
import { ApiRequestError, type ApiClient, type WalletGetter } from "./client";

export interface MockApiClientOptions {
  getWallet?: WalletGetter;
  chainId?: number;
  /** Interval between simulated meter samples. */
  tickMs?: number;
  /** Energy added per tick (accelerated for the demo). */
  whPerTick?: number;
  /** Simulated charger power shown in the UI. */
  powerW?: number;
  quoteTtlSeconds?: number;
}

type Address = `0x${string}`;

interface SessionRuntime {
  session: ChargingSession;
  samples: MeterSampleForHash[];
  timer: ReturnType<typeof setInterval> | null;
  proof: ProofResponse | null;
}

function fail(code: ApiErrorCode, message: string): never {
  throw new ApiRequestError(code, message, API_ERROR_HTTP_STATUS[code]);
}

const mockTx = (seed: string): Address => {
  // Deterministic-looking 32-byte hash per event; only its format matters in mock mode.
  const hex = Array.from(seed)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex.padEnd(64, "0").slice(0, 64)}`;
};

const MOCK_SIGNATURE: Address = `0x${"ab".repeat(65)}`;

export function createMockApiClient(options: MockApiClientOptions = {}): ApiClient {
  const chainId = options.chainId ?? 10143;
  const tickMs = options.tickMs ?? 1000;
  const whPerTick = options.whPerTick ?? 1000;
  const powerW = options.powerW ?? 7400;
  const quoteTtlSeconds = options.quoteTtlSeconds ?? 300;

  const fixtures = createDemoFixtures();
  const nodes = new Map<string, ChargingNode>([[fixtures.node.id, { ...fixtures.node }]]);
  const slots = new Map<string, EnergySlot>([[fixtures.slot.id, { ...fixtures.slot }]]);
  const intents = new Map<string, ChargeIntent>();
  const reservations = new Map<string, Reservation>();
  const sessions = new Map<string, SessionRuntime>();
  let ocppTransactionCounter = 0;
  let meterRegisterWh = 1_000_000;

  const now = () => new Date();
  const iso = () => now().toISOString();
  const clone = <T>(value: T): T => structuredClone(value);

  const wallet = (): Address | null => {
    const w = options.getWallet?.();
    return w ? normalizeAddress(w) : null;
  };
  // Without a connected wallet the mock acts as the demo driver / host, so the
  // flow can be clicked through without MetaMask.
  const driverAddress = () => wallet() ?? DEMO_DRIVER_ADDRESS;
  const hostAddress = () => wallet() ?? DEMO_HOST_ADDRESS;

  const toPublicNode = (node: ChargingNode): PublicChargingNode => PublicChargingNode.parse(node);

  const getNodeOrFail = (id: string) => nodes.get(id) ?? fail("NOT_FOUND", "Node not found.");
  const getSlotOrFail = (id: string) => slots.get(id) ?? fail("NOT_FOUND", "Slot not found.");
  const getIntentOrFail = (id: string) =>
    intents.get(id) ?? fail("NOT_FOUND", "Intent not found.");
  const getReservationOrFail = (id: string) =>
    reservations.get(id) ?? fail("NOT_FOUND", "Reservation not found.");
  const getSessionOrFail = (id: string) =>
    sessions.get(id) ?? fail("NOT_FOUND", "Session not found.");

  const touch = (r: Reservation) => {
    r.updatedAt = iso();
  };

  /** Releases expired holds, mirroring the API's lazy expiry. */
  const expireHolds = () => {
    const nowMs = now().getTime();
    for (const r of reservations.values()) {
      if (r.status === "PENDING_PAYMENT" && Date.parse(r.holdExpiresAt) <= nowMs) {
        r.status = "HOLD_EXPIRED";
        touch(r);
        const slot = slots.get(r.slotId);
        if (slot?.status === "HELD") slot.status = "OPEN";
      }
    }
  };

  /** Driver-facing view: access info only in the allowed states. */
  const driverView = (r: Reservation): Reservation => {
    const node = nodes.get(r.node.id);
    const showAccess =
      node && ["CONFIRMED", "ACTIVE", "COMPLETED", "SETTLED"].includes(r.status);
    return clone({
      ...r,
      access: showAccess
        ? {
            addressLine: node.addressLine,
            lat: node.lat,
            lng: node.lng,
            accessInstructions: node.accessInstructions,
          }
        : null,
    });
  };
  const hostView = (r: Reservation): Reservation => clone({ ...r, access: null });
  const viewFor = (r: Reservation) =>
    wallet() !== null && wallet() === r.hostAddress && wallet() !== r.driverAddress
      ? hostView(r)
      : driverView(r);

  const candidates = (): MatchCandidate[] =>
    [...slots.values()].flatMap((slot) => {
      const node = nodes.get(slot.nodeId);
      if (!node) return [];
      const hold = [...reservations.values()].find(
        (r) => r.slotId === slot.id && r.status === "PENDING_PAYMENT",
      );
      return [{ slot, node, holdExpiresAt: hold?.holdExpiresAt ?? null }];
    });

  const matchesFor = (intent: ChargeIntent) => {
    expireHolds();
    return rankMatches(intent, candidates(), now());
  };

  // ---------- Charging simulation ----------

  const finalizeSession = (rt: SessionRuntime) => {
    const s = rt.session;
    const reservation = getReservationOrFail(s.reservationId);
    const stoppedAt = s.stoppedAt ?? iso();
    const summary: ProofOfChargeSummary = {
      version: PROOF_VERSION,
      chainId,
      contract: DEMO_CONTRACT_ADDRESS,
      reservationId: reservation.onchainId,
      chargePointId: s.chargePointId,
      connectorId: s.connectorId,
      ocppTransactionId: s.ocppTransactionId ?? 0,
      startedAt: s.startedAt ?? stoppedAt,
      stoppedAt,
      meterStartWh: s.meterStartWh ?? 0,
      meterStopWh: s.latestMeterWh ?? s.meterStartWh ?? 0,
      requestedWh: s.requestedWh,
      deliveredWh: s.deliveredWh,
      stopReason: s.stopReason ?? "Remote",
      meterSamples: { count: rt.samples.length, samplesHash: computeSamplesHash(rt.samples) },
      source: "ocpp-simulator",
    };
    const sessionHash = computeSessionHash(summary);
    const result = computeSettlement({
      requestedWh: reservation.requestedWh,
      deliveredWh: s.deliveredWh,
      pricePerKwhWei: reservation.pricePerKwhWei,
      depositWei: reservation.depositWei,
    });
    const settlement = {
      deliveredWh: s.deliveredWh,
      billableWh: result.billableWh,
      hostAmountWei: result.hostAmountWei.toString(),
      refundWei: result.refundWei.toString(),
      sessionHash,
    };
    const settleTx = mockTx(`settle:${s.id}`);

    s.status = "SETTLED";
    s.sessionHash = sessionHash;
    s.txs.settle = settleTx;
    s.updatedAt = iso();

    reservation.status = "SETTLED";
    reservation.settlement = settlement;
    reservation.txs.settle = settleTx;
    touch(reservation);

    const onchain = { ...settlement, txHash: settleTx };
    rt.proof = {
      summary,
      canonicalJson: canonicalize(summary),
      sessionHash,
      onchain,
      verified: computeSessionHash(summary) === onchain.sessionHash,
    };
  };

  const stopRuntime = (rt: SessionRuntime) => {
    if (rt.timer !== null) clearInterval(rt.timer);
    rt.timer = null;
  };

  /** One simulated step: STARTING -> CHARGING -> (STOPPING) -> COMPLETED -> SETTLED. */
  const tick = (rt: SessionRuntime) => {
    const s = rt.session;
    const reservation = reservations.get(s.reservationId);
    switch (s.status) {
      case "STARTING": {
        s.status = "CHARGING";
        s.ocppTransactionId = ++ocppTransactionCounter;
        s.meterStartWh = meterRegisterWh;
        s.latestMeterWh = meterRegisterWh;
        s.startedAt = iso();
        s.powerW = powerW;
        s.txs.start = mockTx(`start:${s.id}`);
        if (reservation) {
          reservation.txs.start = s.txs.start;
          touch(reservation);
        }
        break;
      }
      case "CHARGING": {
        const delivered = Math.min(s.deliveredWh + whPerTick, s.requestedWh);
        s.deliveredWh = delivered;
        s.latestMeterWh = (s.meterStartWh ?? 0) + delivered;
        rt.samples.push({ timestamp: iso(), energyWh: s.latestMeterWh, powerW });
        if (delivered >= s.requestedWh) {
          // Backend sends RemoteStopTransaction once the requested energy is reached.
          s.stopReason = "Remote";
          s.status = "STOPPING";
        }
        break;
      }
      case "STOPPING": {
        s.status = "COMPLETED";
        s.powerW = 0;
        s.stoppedAt = iso();
        meterRegisterWh = s.latestMeterWh ?? meterRegisterWh;
        if (reservation) {
          reservation.status = "COMPLETED";
          touch(reservation);
        }
        break;
      }
      case "COMPLETED":
      case "SETTLING": {
        finalizeSession(rt);
        stopRuntime(rt);
        break;
      }
      default:
        stopRuntime(rt);
    }
    s.updatedAt = iso();
  };

  const nodeByChargePoint = (chargePointId: string, connectorId: number) =>
    [...nodes.values()].find(
      (n) => n.ocppChargePointId === chargePointId && n.ocppConnectorId === connectorId,
    );

  // ---------- ApiClient ----------

  const client: ApiClient = {
    async config(): Promise<AppConfig> {
      return {
        chainId,
        chainMode: "mock",
        contractAddress: DEMO_CONTRACT_ADDRESS,
        settlerAddress: null,
        explorerUrl: null,
        quoteTtlSeconds,
      };
    },

    async chargers(): Promise<ChargerStatus[]> {
      return [...nodes.values()].map((n) => ({
        chargePointId: n.ocppChargePointId,
        connected: n.online,
        lastSeenAt: iso(),
        connectorStatus: "Available",
      }));
    },

    async demoSeed() {
      // Idempotent: the demo node is (re)assigned to the caller, with an open slot.
      const node = getNodeOrFail(fixtures.node.id);
      node.hostAddress = hostAddress();
      const slot = getSlotOrFail(fixtures.slot.id);
      if (slot.status === "CLOSED") slot.status = "OPEN";
      return clone({ node, slot });
    },

    async createNode(body) {
      const input = CreateNodeRequest.parse(body);
      if ([...nodes.values()].some((n) => n.ocppChargePointId === input.ocppChargePointId)) {
        fail("VALIDATION_ERROR", "ocppChargePointId is already in use.");
      }
      const node: ChargingNode = ChargingNode.parse({
        ...input,
        id: crypto.randomUUID(),
        hostAddress: hostAddress(),
        online: true,
        createdAt: iso(),
        startUrl: `http://localhost:3000/start?cp=${encodeURIComponent(
          input.ocppChargePointId,
        )}&c=${input.ocppConnectorId}`,
      });
      nodes.set(node.id, node);
      return clone(node);
    },

    async listMyNodes() {
      const me = hostAddress();
      return clone([...nodes.values()].filter((n) => n.hostAddress === me));
    },

    async getNode(nodeId) {
      const node = getNodeOrFail(nodeId);
      return node.hostAddress === hostAddress() ? clone(node) : toPublicNode(node);
    },

    async createSlot(nodeId, body) {
      getNodeOrFail(nodeId);
      const input = CreateSlotRequest.parse(body);
      const start = Date.parse(input.startsAt);
      const end = Date.parse(input.endsAt);
      if (end <= now().getTime()) fail("VALIDATION_ERROR", "endsAt must be in the future.");
      const overlaps = [...slots.values()].some(
        (s) =>
          s.nodeId === nodeId &&
          s.status !== "CLOSED" &&
          Date.parse(s.startsAt) < end &&
          start < Date.parse(s.endsAt),
      );
      if (overlaps) fail("INVALID_STATE", "Slot overlaps an existing slot.");
      const id = crypto.randomUUID();
      const slot: EnergySlot = {
        id,
        nodeId,
        slotRef: toSlotRef(id),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        maxEnergyWh: input.maxEnergyWh,
        pricePerKwhWei: input.pricePerKwhWei,
        status: "OPEN",
        createdAt: iso(),
      };
      slots.set(id, slot);
      return clone(slot);
    },

    async listSlots(nodeId) {
      getNodeOrFail(nodeId);
      expireHolds();
      return clone(
        [...slots.values()]
          .filter((s) => s.nodeId === nodeId)
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
      );
    },

    async closeSlot(slotId) {
      expireHolds();
      const slot = getSlotOrFail(slotId);
      if (slot.status !== "OPEN") fail("INVALID_STATE", "Only OPEN slots can be closed.");
      slot.status = "CLOSED";
      return clone(slot);
    },

    async listNodeReservations(nodeId) {
      getNodeOrFail(nodeId);
      expireHolds();
      return [...reservations.values()]
        .filter((r) => r.node.id === nodeId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(hostView);
    },

    async createIntent(body) {
      const input = CreateIntentRequest.parse(body);
      const intent: ChargeIntent = {
        id: crypto.randomUUID(),
        driverAddress: driverAddress(),
        ...input,
        createdAt: iso(),
      };
      intents.set(intent.id, intent);
      return clone(intent);
    },

    async getIntent(intentId) {
      return clone(getIntentOrFail(intentId));
    },

    async getMatches(intentId): Promise<MatchesResponse> {
      const intent = getIntentOrFail(intentId);
      return { intentId, generatedAt: iso(), matches: clone(matchesFor(intent)) };
    },

    async createReservation(body) {
      const intent = getIntentOrFail(body.intentId);
      const slot = getSlotOrFail(body.slotId);
      const match = matchesFor(intent).find((m) => m.slotId === slot.id);
      if (!match) fail("SLOT_UNAVAILABLE", "Slot is already held or reserved.");
      const m = match;

      const id = crypto.randomUUID();
      const onchainId = toOnchainReservationId(id);
      const holdExpiresAtMs = now().getTime() + quoteTtlSeconds * 1000;
      const node = getNodeOrFail(slot.nodeId);

      const reservation: Reservation = {
        id,
        onchainId,
        intentId: intent.id,
        slotId: slot.id,
        driverAddress: intent.driverAddress,
        hostAddress: node.hostAddress,
        status: "PENDING_PAYMENT",
        requestedWh: m.quotedWh,
        pricePerKwhWei: m.pricePerKwhWei,
        depositWei: m.depositWei,
        window: m.window,
        holdExpiresAt: new Date(holdExpiresAtMs).toISOString(),
        node: m.node,
        access: null,
        sessionId: null,
        txs: { reserve: null, start: null, settle: null, cancel: null },
        settlement: null,
        createdAt: iso(),
        updatedAt: iso(),
      };
      reservations.set(id, reservation);
      slot.status = "HELD";

      const quote: ReservationQuote = {
        reservationId: onchainId,
        slotRef: slot.slotRef,
        driver: reservation.driverAddress,
        host: reservation.hostAddress,
        requestedWh: m.quotedWh,
        pricePerKwhWei: m.pricePerKwhWei,
        depositWei: m.depositWei,
        startTime: Math.floor(Date.parse(m.window.startsAt) / 1000),
        endTime: Math.floor(Date.parse(m.window.endsAt) / 1000),
        quoteExpiry: Math.floor(holdExpiresAtMs / 1000),
      };

      return CreateReservationResponse.parse({
        reservation: driverView(reservation),
        quote,
        signature: MOCK_SIGNATURE,
        contractAddress: DEMO_CONTRACT_ADDRESS,
        chainId,
      });
    },

    async confirmReservation(id, body) {
      const txHash = Hex32.safeParse(body.txHash);
      if (!txHash.success) fail("VALIDATION_ERROR", "txHash must be a 32-byte hex string.");
      const r = getReservationOrFail(id);
      // Idempotent: confirming an already confirmed reservation returns it unchanged.
      if (r.status === "PENDING_PAYMENT") {
        r.status = "CONFIRMED";
        r.txs.reserve = body.txHash;
        touch(r);
        const slot = slots.get(r.slotId);
        if (slot) slot.status = "RESERVED";
      } else if (r.status !== "CONFIRMED" || r.txs.reserve !== body.txHash) {
        fail("INVALID_STATE", `Reservation is ${r.status}.`);
      }
      return driverView(r);
    },

    async syncReservation(id) {
      expireHolds();
      return viewFor(getReservationOrFail(id));
    },

    async listReservations(role) {
      expireHolds();
      const me = role === "driver" ? driverAddress() : hostAddress();
      return [...reservations.values()]
        .filter((r) => (role === "driver" ? r.driverAddress : r.hostAddress) === me)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(role === "driver" ? driverView : hostView);
    },

    async getReservation(id) {
      expireHolds();
      return viewFor(getReservationOrFail(id));
    },

    async getProof(id) {
      const r = getReservationOrFail(id);
      const rt = r.sessionId ? sessions.get(r.sessionId) : undefined;
      if (!rt?.proof) fail("INVALID_STATE", "Proof is available after settlement.");
      return clone(rt.proof);
    },

    async startSession(body) {
      const me = driverAddress();
      let reservation: Reservation;
      if (body.reservationId) {
        reservation = getReservationOrFail(body.reservationId);
      } else {
        const found = [...reservations.values()].filter(
          (r) =>
            r.driverAddress === me &&
            r.status === "CONFIRMED" &&
            r.node.ocppChargePointId === body.chargePointId &&
            r.node.ocppConnectorId === body.connectorId,
        );
        if (found.length > 1) fail("AMBIGUOUS_RESERVATION", "Multiple reservations found.");
        reservation = found[0] ?? fail("NOT_FOUND", "No confirmed reservation at this charger.");
      }
      if (reservation.status !== "CONFIRMED") {
        fail("INVALID_STATE", `Reservation is ${reservation.status}.`);
      }
      const node = nodeByChargePoint(body.chargePointId, body.connectorId);
      if (!node || node.id !== reservation.node.id) {
        fail("INVALID_STATE", "Charge point does not match the reservation.");
      }
      if (!node.online) fail("CHARGER_OFFLINE", "Charger is offline.");

      const session: ChargingSession = {
        id: crypto.randomUUID(),
        reservationId: reservation.id,
        status: "STARTING",
        chargePointId: body.chargePointId,
        connectorId: body.connectorId,
        ocppTransactionId: null,
        requestedWh: reservation.requestedWh,
        meterStartWh: null,
        latestMeterWh: null,
        deliveredWh: 0,
        powerW: 0,
        startedAt: null,
        stoppedAt: null,
        stopReason: null,
        sessionHash: null,
        txs: { start: null, settle: null },
        updatedAt: iso(),
      };
      const rt: SessionRuntime = { session, samples: [], timer: null, proof: null };
      rt.timer = setInterval(() => tick(rt), tickMs);
      sessions.set(session.id, rt);

      reservation.status = "ACTIVE";
      reservation.sessionId = session.id;
      touch(reservation);
      return clone(session);
    },

    async getSession(id) {
      return clone(getSessionOrFail(id).session);
    },

    async stopSession(id) {
      const rt = getSessionOrFail(id);
      const s = rt.session;
      if (s.status !== "CHARGING" && s.status !== "STARTING") {
        fail("INVALID_STATE", `Session is ${s.status}.`);
      }
      s.status = "STOPPING";
      s.stopReason = "Remote";
      s.updatedAt = iso();
      return clone(s);
    },

    sessionEventsUrl() {
      return null;
    },
  };

  return client;
}
