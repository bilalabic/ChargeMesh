import { randomUUID } from "node:crypto";
import {
  ConfirmReservationRequest,
  CreateReservationRequest,
  CreateReservationResponse,
  ListReservationsQuery,
  ReservationQuote,
  SyncReservationRequest,
  computeSettlement,
  toOnchainReservationId,
  type ReservationStatus,
} from "@chargemesh/shared";
import type { FastifyPluginAsync } from "fastify";
import type { Hex } from "viem";
import { z } from "zod";
import { findMatches, toReservation } from "../../domain";
import type { ReservationDocument, ReservationPatch } from "../../db/types";
import { assertOwner, requireWallet } from "../auth";
import { ApiError, notImplemented } from "../errors";
import type { RouteDeps } from "./deps";

const ReservationParams = z.object({ id: z.uuid() });

function assertParty(wallet: string, reservation: ReservationDocument): void {
  if (wallet !== reservation.driverAddress && wallet !== reservation.hostAddress) {
    throw new ApiError("FORBIDDEN", "Reservation does not belong to this wallet");
  }
}

async function loadReservation(deps: RouteDeps, id: string): Promise<ReservationDocument> {
  const reservation = await deps.store.findReservation(id);
  if (!reservation) throw new ApiError("NOT_FOUND", "Reservation not found");
  return reservation;
}

export function reservationRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.post("/reservations", async (request, reply) => {
      const wallet = requireWallet(request);
      const input = CreateReservationRequest.parse(request.body);
      const intent = await deps.store.findIntent(input.intentId);
      if (!intent) throw new ApiError("NOT_FOUND", "Charge intent not found");
      assertOwner(wallet, intent.driverAddress);

      const now = new Date();
      await deps.store.releaseExpiredHolds(now);
      const match = (await findMatches(deps.store, deps.chargers, intent._id, now)).find(
        (candidate) => candidate.slotId === input.slotId,
      );
      if (!match) throw new ApiError("SLOT_UNAVAILABLE", "Selected slot is no longer available");
      const slot = await deps.store.findSlot(input.slotId);
      if (!slot) throw new ApiError("SLOT_UNAVAILABLE", "Selected slot is no longer available");
      const node = await deps.store.findNode(slot.nodeId);
      if (!node) throw new ApiError("SLOT_UNAVAILABLE", "Selected slot has no charging node");

      const id = randomUUID();
      const holdExpiresAt = new Date(now.getTime() + deps.config.quoteTtlSeconds * 1_000);
      const quote = ReservationQuote.parse({
        reservationId: toOnchainReservationId(id),
        slotRef: slot.slotRef,
        driver: wallet,
        host: node.hostAddress,
        requestedWh: match.quotedWh,
        pricePerKwhWei: match.pricePerKwhWei,
        depositWei: match.depositWei,
        startTime: Math.floor(new Date(match.window.startsAt).getTime() / 1_000),
        endTime: Math.floor(new Date(match.window.endsAt).getTime() / 1_000),
        quoteExpiry: Math.floor(holdExpiresAt.getTime() / 1_000),
      });
      const signature = await deps.chain.signQuote(quote);
      const document: ReservationDocument = {
        _id: id,
        onchainId: quote.reservationId,
        intentId: intent._id,
        slotId: slot._id,
        driverAddress: wallet,
        hostAddress: node.hostAddress,
        status: "PENDING_PAYMENT",
        requestedWh: quote.requestedWh,
        pricePerKwhWei: quote.pricePerKwhWei,
        depositWei: quote.depositWei,
        windowStartsAt: new Date(match.window.startsAt),
        windowEndsAt: new Date(match.window.endsAt),
        holdExpiresAt,
        quoteSignature: signature,
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
      const claimed = await deps.store.claimSlotAndCreateReservation(slot._id, document, now);
      if (claimed !== "claimed") {
        throw new ApiError("SLOT_UNAVAILABLE", "Selected slot was claimed by another reservation");
      }
      return reply.status(201).send(
        CreateReservationResponse.parse({
          reservation: await toReservation(deps.store, document, wallet, deps.chargers),
          quote,
          signature,
          contractAddress: deps.chain.contractAddress,
          chainId: deps.chain.chainId,
        }),
      );
    });

    app.post("/reservations/:id/confirm", async (request) => {
      const wallet = requireWallet(request);
      const { id } = ReservationParams.parse(request.params);
      const input = ConfirmReservationRequest.parse(request.body);
      const reservation = await loadReservation(deps, id);
      assertOwner(wallet, reservation.driverAddress);
      if (reservation.status === "CONFIRMED" && reservation.reserveTxHash === input.txHash) {
        return toReservation(deps.store, reservation, wallet, deps.chargers);
      }
      if (reservation.status !== "PENDING_PAYMENT") {
        throw new ApiError("INVALID_STATE", `Cannot confirm a ${reservation.status} reservation`);
      }
      const verification = await deps.chain.verifyReserveTx(input.txHash as Hex, reservation.onchainId as Hex);
      if (!verification.ok) {
        throw new ApiError("CHAIN_VERIFICATION_FAILED", verification.reason);
      }
      const confirmed = await deps.store.confirmReservation(id, verification.txHash, new Date());
      if (!confirmed) throw new ApiError("INVALID_STATE", "Reservation hold is no longer confirmable");
      return toReservation(deps.store, confirmed, wallet, deps.chargers);
    });

    app.post("/reservations/:id/sync", async (request) => {
      const wallet = requireWallet(request);
      const { id } = ReservationParams.parse(request.params);
      const input = SyncReservationRequest.parse(request.body ?? {});
      const reservation = await loadReservation(deps, id);
      assertOwner(wallet, reservation.driverAddress);
      const onchain = await deps.chain.readReservation(reservation.onchainId as Hex);
      if (!onchain) throw new ApiError("CHAIN_VERIFICATION_FAILED", "Reservation does not exist on-chain");
      if (
        onchain.driver.toLowerCase() !== reservation.driverAddress ||
        onchain.host.toLowerCase() !== reservation.hostAddress
      ) {
        throw new ApiError("CHAIN_VERIFICATION_FAILED", "On-chain reservation parties do not match");
      }

      const statusByChain: Record<typeof onchain.status, ReservationStatus | null> = {
        None: null,
        Reserved: "CONFIRMED",
        Active: "ACTIVE",
        Settled: "SETTLED",
        Cancelled: "CANCELLED",
        Expired: "EXPIRED",
      };
      const status = statusByChain[onchain.status];
      if (!status) throw new ApiError("CHAIN_VERIFICATION_FAILED", "Reservation has no on-chain state");
      const patch: ReservationPatch = { status, failureReason: null };
      if (input.txHash && onchain.status === "Reserved") patch.reserveTxHash = input.txHash;
      if (input.txHash && (onchain.status === "Cancelled" || onchain.status === "Expired")) {
        patch.cancelTxHash = input.txHash;
      }
      if (onchain.status === "Settled") {
        const settlement = computeSettlement({
          requestedWh: reservation.requestedWh,
          deliveredWh: onchain.deliveredWh,
          pricePerKwhWei: reservation.pricePerKwhWei,
          depositWei: reservation.depositWei,
        });
        patch.settledDeliveredWh = onchain.deliveredWh;
        patch.billableWh = settlement.billableWh;
        patch.hostAmountWei = settlement.hostAmountWei.toString();
        patch.refundWei = settlement.refundWei.toString();
        patch.sessionHash = onchain.sessionHash;
        if (input.txHash) patch.settleTxHash = input.txHash;
      }
      const synced = await deps.store.syncReservationState(
        id,
        patch,
        onchain.status === "Cancelled" || onchain.status === "Expired",
        new Date(),
      );
      if (!synced) throw new ApiError("NOT_FOUND", "Reservation not found");
      return toReservation(deps.store, synced, wallet, deps.chargers);
    });

    app.get("/reservations", async (request) => {
      const wallet = requireWallet(request);
      const { role } = ListReservationsQuery.parse(request.query);
      const reservations = await deps.store.listReservationsByWallet(wallet, role);
      return Promise.all(reservations.map((item) => toReservation(deps.store, item, wallet, deps.chargers)));
    });

    app.get("/reservations/:id", async (request) => {
      const wallet = requireWallet(request);
      const { id } = ReservationParams.parse(request.params);
      const reservation = await loadReservation(deps, id);
      assertParty(wallet, reservation);
      return toReservation(deps.store, reservation, wallet, deps.chargers);
    });

    app.get("/reservations/:id/proof", async (_request, reply) => notImplemented(reply));
  };
}
