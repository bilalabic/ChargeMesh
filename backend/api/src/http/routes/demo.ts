import { DemoSeedResponse, toSlotRef } from "@chargemesh/shared";
import {
  DEMO_CHARGE_POINT_ID,
  DEMO_IDS,
  DEMO_PRICE_PER_KWH_WEI,
  createDemoFixtures,
} from "@chargemesh/shared/fixtures";
import type { FastifyPluginAsync } from "fastify";
import { toEnergySlot, toPrivateNode } from "../../domain";
import type { NodeDocument, SlotDocument } from "../../db/types";
import { requireWallet } from "../auth";
import { ApiError } from "../errors";
import type { RouteDeps } from "./deps";

export function demoRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    if (deps.config.nodeEnv !== "test" || deps.config.chainMode !== "mock") return;

    app.post("/demo/seed", async (request) => {
      const wallet = requireWallet(request);
      const now = new Date();
      const fixture = createDemoFixtures(now);
      let node = await deps.store.findNodeByChargePoint(DEMO_CHARGE_POINT_ID);
      if (node && node.hostAddress !== wallet) {
        throw new ApiError("INVALID_STATE", "Demo charge point belongs to another host wallet");
      }
      if (!node) {
        node = {
          _id: DEMO_IDS.node,
          hostAddress: wallet,
          name: fixture.node.name,
          areaLabel: fixture.node.areaLabel,
          addressLine: fixture.node.addressLine,
          lat: fixture.node.lat,
          lng: fixture.node.lng,
          accessInstructions: fixture.node.accessInstructions,
          connectorType: fixture.node.connectorType,
          maxPowerKw: fixture.node.maxPowerKw,
          accessType: fixture.node.accessType,
          ocppChargePointId: DEMO_CHARGE_POINT_ID,
          ocppConnectorId: fixture.node.ocppConnectorId,
          createdAt: now,
          updatedAt: now,
        } satisfies NodeDocument;
        await deps.store.createNode(node);
      }

      let slot = (await deps.store.listSlotsByNode(node._id)).find((item) => item._id === DEMO_IDS.slot);
      if (!slot) {
        slot = {
          _id: DEMO_IDS.slot,
          nodeId: node._id,
          slotRef: toSlotRef(DEMO_IDS.slot),
          startsAt: new Date(now.getTime() - 5 * 60_000),
          endsAt: new Date(now.getTime() + 9 * 60 * 60_000),
          maxEnergyWh: 40_000,
          pricePerKwhWei: DEMO_PRICE_PER_KWH_WEI,
          status: "OPEN",
          heldUntil: null,
          createdAt: now,
          updatedAt: now,
        } satisfies SlotDocument;
        await deps.store.createSlot(slot);
      }

      return DemoSeedResponse.parse({
        node: toPrivateNode(
          node,
          deps.chargers.isConnected(node.ocppChargePointId),
          deps.config.webBaseUrl,
        ),
        slot: toEnergySlot(slot),
      });
    });
  };
}
