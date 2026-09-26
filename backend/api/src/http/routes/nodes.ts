import { randomUUID } from "node:crypto";
import { CreateNodeRequest, CreateSlotRequest, EnergySlot, toSlotRef } from "@chargemesh/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { nodeOnline, toEnergySlot, toPrivateNode, toPublicNode, toReservation } from "../../domain";
import type { NodeDocument, SlotDocument } from "../../db/types";
import { assertOwner, optionalWallet, requireWallet } from "../auth";
import { ApiError } from "../errors";
import type { RouteDeps } from "./deps";

const IdParams = z.object({ nodeId: z.uuid() });
const MineQuery = z.object({ mine: z.literal("true") });

export function nodeRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.post("/nodes", async (request, reply) => {
      const wallet = requireWallet(request);
      const input = CreateNodeRequest.parse(request.body);
      if (await deps.store.findNodeByChargePoint(input.ocppChargePointId)) {
        throw new ApiError("INVALID_STATE", "A node already uses this OCPP charge point id");
      }
      const now = new Date();
      const document: NodeDocument = {
        _id: randomUUID(),
        hostAddress: wallet,
        name: input.name,
        areaLabel: input.areaLabel,
        addressLine: input.addressLine,
        lat: input.lat,
        lng: input.lng,
        accessInstructions: input.accessInstructions ?? "",
        connectorType: input.connectorType,
        maxPowerKw: input.maxPowerKw,
        accessType: input.accessType,
        ocppChargePointId: input.ocppChargePointId,
        ocppConnectorId: input.ocppConnectorId ?? 1,
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.createNode(document);
      return reply.status(201).send(
        toPrivateNode(document, deps.chargers.isConnected(document.ocppChargePointId), deps.config.webBaseUrl),
      );
    });

    app.get("/nodes", async (request) => {
      const wallet = requireWallet(request);
      MineQuery.parse(request.query);
      const chargers = deps.chargers.list();
      const nodes = await deps.store.listNodesByHost(wallet);
      return nodes.map((node) => toPrivateNode(node, nodeOnline(node, chargers), deps.config.webBaseUrl));
    });

    app.get("/nodes/:nodeId", async (request) => {
      const { nodeId } = IdParams.parse(request.params);
      const node = await deps.store.findNode(nodeId);
      if (!node) throw new ApiError("NOT_FOUND", "Charging node not found");
      const online = deps.chargers.isConnected(node.ocppChargePointId);
      const wallet = optionalWallet(request);
      return wallet === node.hostAddress
        ? toPrivateNode(node, online, deps.config.webBaseUrl)
        : toPublicNode(node, online);
    });

    app.post("/nodes/:nodeId/slots", async (request, reply) => {
      const wallet = requireWallet(request);
      const { nodeId } = IdParams.parse(request.params);
      const input = CreateSlotRequest.parse(request.body);
      const node = await deps.store.findNode(nodeId);
      if (!node) throw new ApiError("NOT_FOUND", "Charging node not found");
      assertOwner(wallet, node.hostAddress);

      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const now = new Date();
      if (endsAt <= now) throw new ApiError("VALIDATION_ERROR", "Slot end time must be in the future");
      const overlaps = (await deps.store.listSlotsByNode(nodeId)).some(
        (slot) => slot.status !== "CLOSED" && slot.startsAt < endsAt && slot.endsAt > startsAt,
      );
      if (overlaps) throw new ApiError("INVALID_STATE", "Slot overlaps an existing active slot");

      const id = randomUUID();
      const document: SlotDocument = {
        _id: id,
        nodeId,
        slotRef: toSlotRef(id),
        startsAt,
        endsAt,
        maxEnergyWh: input.maxEnergyWh,
        pricePerKwhWei: input.pricePerKwhWei,
        status: "OPEN",
        heldUntil: null,
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.createSlot(document);
      return reply.status(201).send(EnergySlot.parse(toEnergySlot(document)));
    });

    app.get("/nodes/:nodeId/slots", async (request) => {
      const { nodeId } = IdParams.parse(request.params);
      if (!(await deps.store.findNode(nodeId))) throw new ApiError("NOT_FOUND", "Charging node not found");
      return (await deps.store.listSlotsByNode(nodeId)).map(toEnergySlot);
    });

    app.get("/nodes/:nodeId/reservations", async (request) => {
      const wallet = requireWallet(request);
      const { nodeId } = IdParams.parse(request.params);
      const node = await deps.store.findNode(nodeId);
      if (!node) throw new ApiError("NOT_FOUND", "Charging node not found");
      assertOwner(wallet, node.hostAddress);
      const reservations = await deps.store.listReservationsByNode(nodeId);
      return Promise.all(reservations.map((item) => toReservation(deps.store, item, wallet, deps.chargers)));
    });
  };
}
