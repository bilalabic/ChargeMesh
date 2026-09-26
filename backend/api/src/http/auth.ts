/**
 * Demo-only identity (docs/03-api.md, "Kimlik"): the connected wallet address is sent
 * in the `x-wallet-address` header (or `?wallet=` for SSE). No signature check.
 */
import { WALLET_HEADER, WALLET_QUERY_PARAM, normalizeAddress } from "@chargemesh/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "./errors";

export type WalletAddress = `0x${string}`;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function readRaw(request: FastifyRequest, allowQuery: boolean): string | undefined {
  const header = request.headers[WALLET_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader) return fromHeader.trim();
  if (allowQuery) {
    const query = request.query as Record<string, unknown> | undefined;
    const q = query?.[WALLET_QUERY_PARAM];
    if (typeof q === "string" && q.length > 0) return q.trim();
  }
  return undefined;
}

/** Returns the lower-cased wallet address, or null when absent. Throws 401 when malformed. */
export function optionalWallet(
  request: FastifyRequest,
  opts: { allowQuery?: boolean } = {},
): WalletAddress | null {
  const raw = readRaw(request, opts.allowQuery ?? false);
  if (raw === undefined) return null;
  if (!ADDRESS_RE.test(raw)) {
    throw new ApiError("UNAUTHORIZED", `Invalid ${WALLET_HEADER} header`);
  }
  return normalizeAddress(raw);
}

/** Returns the lower-cased wallet address or throws 401 UNAUTHORIZED. */
export function requireWallet(
  request: FastifyRequest,
  opts: { allowQuery?: boolean } = {},
): WalletAddress {
  const wallet = optionalWallet(request, opts);
  if (!wallet) throw new ApiError("UNAUTHORIZED", `Missing ${WALLET_HEADER} header`);
  return wallet;
}

/** Throws 403 FORBIDDEN unless `owner` equals the caller (both compared lower-case). */
export function assertOwner(wallet: WalletAddress, owner: string): void {
  if (owner.toLowerCase() !== wallet) {
    throw new ApiError("FORBIDDEN", "Resource does not belong to this wallet");
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Lower-cased caller wallet from `x-wallet-address`, or null when absent/invalid. */
    wallet: WalletAddress | null;
  }
}

/** Populates `request.wallet` for every request. Routes enforce it with `requireWallet`. */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest("wallet", null);
  app.addHook("onRequest", async (request) => {
    const raw = readRaw(request, false);
    request.wallet = raw !== undefined && ADDRESS_RE.test(raw) ? normalizeAddress(raw) : null;
  });
}
