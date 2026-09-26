/**
 * End-to-end smoke test against a local Anvil deployment:
 * a quote signed with the shared EIP-712 definition goes through
 * reserve -> startSession -> settle, and balances must match computeSettlement.
 *
 * Prereqs: anvil running (WSL), escrow deployed with settler = Anvil account #0,
 * `chain:sync` run so deployments.ts has chain 31337.
 * Uses only Anvil's publicly known test keys. Never point this at a public network.
 */
import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ReservationQuote } from "../src/api/schemas";
import { anvilLocal, buildQuoteTypedData, chargeMeshEscrowAbi, getDeployment, quoteToContractArgs } from "../src/chain";
import { toOnchainReservationId, toSlotRef } from "../src/ids";
import { computeSettlement, depositFor, formatMon } from "../src/units";

const SETTLER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0
const DRIVER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil #1
const HOST = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"; // anvil #2
const PRICE = "10000000000000000"; // 0.01 MON/kWh
const REQUESTED_WH = 20000;
const DELIVERED_WH = Number(process.env.DELIVERED_WH ?? 14500);

const deployment = getDeployment(anvilLocal.id);
if (!deployment) throw new Error("No chain 31337 deployment. Deploy to anvil and run chain:sync first.");
const escrow = deployment.escrow;

const transport = http(anvilLocal.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain: anvilLocal, transport });
const settler = createWalletClient({ chain: anvilLocal, transport, account: privateKeyToAccount(SETTLER_KEY) });
const driver = createWalletClient({ chain: anvilLocal, transport, account: privateKeyToAccount(DRIVER_KEY) });

const { timestamp } = await pub.getBlock();
const now = Number(timestamp);
const quote: ReservationQuote = {
  reservationId: toOnchainReservationId(randomUUID()),
  slotRef: toSlotRef(randomUUID()),
  driver: driver.account.address.toLowerCase(),
  host: HOST,
  requestedWh: REQUESTED_WH,
  pricePerKwhWei: PRICE,
  depositWei: depositFor(REQUESTED_WH, PRICE).toString(),
  startTime: now + 60,
  endTime: now + 4 * 3600,
  quoteExpiry: now + 300,
};

const signature = await settler.signTypedData(buildQuoteTypedData(quote, anvilLocal.id, escrow));
const balance = (a: Hex) => pub.getBalance({ address: a });
const hostBefore = await balance(HOST);
const driverBefore = await balance(driver.account.address);

const reserveHash = await driver.writeContract({
  address: escrow,
  abi: chargeMeshEscrowAbi,
  functionName: "reserve",
  args: [quoteToContractArgs(quote), signature],
  value: BigInt(quote.depositWei),
});
const reserveReceipt = await pub.waitForTransactionReceipt({ hash: reserveHash });
const created = parseEventLogs({ abi: chargeMeshEscrowAbi, logs: reserveReceipt.logs, eventName: "ReservationCreated" });
if (created[0]?.args.reservationId !== quote.reservationId) throw new Error("ReservationCreated not found");
const reserveGas = reserveReceipt.gasUsed * reserveReceipt.effectiveGasPrice;

const id = quote.reservationId as Hex;
await pub.waitForTransactionReceipt({
  hash: await settler.writeContract({ address: escrow, abi: chargeMeshEscrowAbi, functionName: "startSession", args: [id] }),
});
const sessionHash = `0x${"ab".repeat(32)}` as Hex;
await pub.waitForTransactionReceipt({
  hash: await settler.writeContract({
    address: escrow,
    abi: chargeMeshEscrowAbi,
    functionName: "settle",
    args: [id, DELIVERED_WH, sessionHash],
  }),
});

const expected = computeSettlement({
  requestedWh: REQUESTED_WH,
  deliveredWh: DELIVERED_WH,
  pricePerKwhWei: PRICE,
  depositWei: quote.depositWei,
});
const hostGain = (await balance(HOST)) - hostBefore;
const driverNet = driverBefore - (await balance(driver.account.address)) - reserveGas;
const onchain = await pub.readContract({ address: escrow, abi: chargeMeshEscrowAbi, functionName: "getReservation", args: [id] });

const checks: [string, boolean][] = [
  ["host received hostAmount", hostGain === expected.hostAmountWei],
  ["driver net cost == hostAmount", driverNet === expected.hostAmountWei],
  ["status Settled (3)", onchain.status === 3],
  ["sessionHash stored", onchain.sessionHash === sessionHash],
  ["deliveredWh stored", onchain.deliveredWh === DELIVERED_WH],
];
console.log(`escrow ${escrow} · delivered ${DELIVERED_WH} Wh`);
console.log(`host +${formatMon(hostGain)} · driver refund ${formatMon(expected.refundWei)}`);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
