import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { toEnergySlot } from "../../domain";
import { assertOwner, requireWallet } from "../auth";
import { ApiError } from "../errors";
import type { RouteDeps } from "./deps";

const SlotParams = z.object({ slotId: z.uuid() });

export function slotRoutes(deps: RouteDeps): FastifyPluginAsync {
  return async (app) => {
    app.post("/slots/:slotId/close", async (request) => {
      const wallet = requireWallet(request);
      const { slotId } = SlotParams.parse(request.params);
      const slot = await deps.store.findSlot(slotId);
      if (!slot) throw new ApiError("NOT_FOUND", "Energy slot not found");
      const node = await deps.store.findNode(slot.nodeId);
      if (!node) throw new ApiError("NOT_FOUND", "Charging node not found");
      assertOwner(wallet, node.hostAddress);
      const closed = await deps.store.closeSlot(slotId, node._id, new Date());
      if (!closed) throw new ApiError("INVALID_STATE", "Only an OPEN slot can be closed");
      return toEnergySlot(closed);
    });
  };
}
