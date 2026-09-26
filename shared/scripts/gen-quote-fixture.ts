/**
 * Writes contracts/test/fixtures/quote-signature.json: a quote signed with the shared
 * EIP-712 definition. The Foundry test must accept this signature, which proves the
 * TypeScript and Solidity typed-data definitions are identical.
 *
 * The signer is Anvil's publicly known account #0 — never a real key.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildQuoteTypedData } from "../src/chain/eip712";
import { toOnchainReservationId, toSlotRef } from "../src/ids";
import { depositFor } from "../src/units";
import type { ReservationQuote } from "../src/api/schemas";

const ANVIL_ACCOUNT_0_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const CHAIN_ID = 31337;
const VERIFYING_CONTRACT = "0x000000000000000000000000000000000000c0de" as const;

const price = "10000000000000000";
const quote: ReservationQuote = {
  reservationId: toOnchainReservationId("00000000-0000-4000-8000-000000000001"),
  slotRef: toSlotRef("00000000-0000-4000-8000-000000000002"),
  driver: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  host: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  requestedWh: 20000,
  pricePerKwhWei: price,
  depositWei: depositFor(20000, price).toString(),
  startTime: 1_800_000_000,
  endTime: 1_800_014_400,
  quoteExpiry: 1_799_999_000,
};

const settler = privateKeyToAccount(ANVIL_ACCOUNT_0_KEY);
const typedData = buildQuoteTypedData(quote, CHAIN_ID, VERIFYING_CONTRACT);
const digest = hashTypedData(typedData);
const signature = await settler.signTypedData(typedData);

const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/test/fixtures/quote-signature.json",
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    { chainId: CHAIN_ID, verifyingContract: VERIFYING_CONTRACT, settler: settler.address, quote, digest, signature },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${out}`);
