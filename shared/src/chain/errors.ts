/**
 * Custom errors of ChargeMeshEscrow → user-facing Turkish messages
 * (docs/04-akilli-sozlesme.md, "Hatalar" and "Entegrasyon rehberi").
 */
import { decodeErrorResult, isHex, type ContractErrorName, type Hex } from "viem";
import { chargeMeshEscrowAbi } from "./abi";
import { ONCHAIN_STATUS_LABELS_TR, onchainStatusName } from "./status";

/** Every custom error name in the generated escrow ABI (including inherited OpenZeppelin errors). */
export type EscrowErrorName = ContractErrorName<typeof chargeMeshEscrowAbi>;

/**
 * Exhaustive over the ABI: a new error in `abi.ts` without a message here,
 * or a message for an error that no longer exists, fails `typecheck`.
 */
export const ESCROW_ERROR_MESSAGES_TR = {
  NotDriver:
    "Bu işlemi yalnızca rezervasyonu yapan cüzdan yapabilir. Doğru cüzdanın bağlı olduğundan emin olun.",
  NotSettler: "Bu işlemi yalnızca ChargeMesh sunucusu yapabilir.",
  InvalidQuote: "Rezervasyon teklifi geçersiz. Lütfen yeni bir teklif alın.",
  QuoteExpired: "Teklifin süresi doldu. Lütfen yeniden rezervasyon teklifi alın.",
  InvalidSignature: "Teklifin imzası doğrulanamadı. Lütfen yeni bir teklif alın.",
  IncorrectDeposit:
    "Gönderilen depozito teklifteki tutarla aynı değil. Lütfen yeni bir teklif alıp tekrar deneyin.",
  ReservationExists: "Bu rezervasyon zaten zincire kaydedilmiş. Yeniden ödeme yapmanız gerekmiyor.",
  SlotAlreadyTaken:
    "Bu şarj aralığı az önce başka bir sürücü tarafından ayrıldı. Lütfen başka bir seçenek belirleyin.",
  InvalidStatus: "Rezervasyon bu işlem için uygun durumda değil.",
  TooLate: "Bu işlemin zamanı geçti. Başlangıç saati gelen bir rezervasyon artık iptal edilemez.",
  TooEarly: "Rezervasyonun süresi henüz dolmadı. Depozito iadesi için biraz daha beklemeniz gerekiyor.",
  ZeroSessionHash: "Şarj oturumunun kaydı eksik olduğu için ödeme tamamlanamadı.",
  TransferFailed:
    "Ödeme cüzdanınıza gönderilemedi. Cüzdanınızın MON kabul edebildiğinden emin olup tekrar deneyin.",
  ZeroAddress: "Geçersiz adres. Sıfır adresi kullanılamaz.",
  NothingToWithdraw: "Çekilecek bekleyen ödemeniz yok.",
  RenounceDisabled: "Sözleşme sahipliğinden vazgeçilemez.",
  InsufficientGas: "İşlem için ayrılan gaz yetersiz kaldı. Cüzdanınızda gaz limitini artırıp tekrar deneyin.",
  OwnableUnauthorizedAccount: "Bu işlemi yalnızca sözleşme sahibi yapabilir.",
  OwnableInvalidOwner: "Geçersiz sahip adresi.",
  ReentrancyGuardReentrantCall: "İşlem güvenlik nedeniyle durduruldu. Lütfen tekrar deneyin.",
  InvalidShortString: "Sözleşmede beklenmeyen bir hata oluştu.",
  StringTooLong: "Sözleşmede beklenmeyen bir hata oluştu.",
} as const satisfies Record<EscrowErrorName, string>;

export interface DecodedEscrowError {
  name: EscrowErrorName;
  args: readonly unknown[];
  /** Turkish, ready to show to the user. */
  message: string;
}

export function isEscrowErrorName(name: unknown): name is EscrowErrorName {
  return typeof name === "string" && Object.hasOwn(ESCROW_ERROR_MESSAGES_TR, name);
}

/** Turkish message for an escrow error; `InvalidStatus(current)` includes the current status. */
export function escrowErrorMessage(name: EscrowErrorName, args: readonly unknown[] = []): string {
  const base: string = ESCROW_ERROR_MESSAGES_TR[name];
  if (name === "InvalidStatus") {
    const current = args[0];
    const status =
      typeof current === "number" || typeof current === "bigint"
        ? onchainStatusName(current)
        : undefined;
    if (status) return `${base} Şu anki durumu: ${ONCHAIN_STATUS_LABELS_TR[status]}.`;
  }
  return base;
}

/** Decodes raw revert data (`0x` + 4-byte selector + args). Non-escrow errors (`Error(string)`, `Panic`) → `null`. */
function decodeRevertData(data: Hex): DecodedEscrowError | null {
  if (data.length < 10) return null;
  try {
    const { errorName, args } = decodeErrorResult({ abi: chargeMeshEscrowAbi, data });
    if (!isEscrowErrorName(errorName)) return null;
    const list: readonly unknown[] = args ?? [];
    return { name: errorName, args: list, message: escrowErrorMessage(errorName, list) };
  } catch {
    return null;
  }
}

function fromNode(node: unknown): DecodedEscrowError | null {
  if (typeof node === "string") return isHex(node) ? decodeRevertData(node) : null;
  if (typeof node !== "object" || node === null) return null;
  const o = node as Record<string, unknown>;

  // viem ContractFunctionRevertedError.raw / RawContractError.data / JSON-RPC error.data
  for (const candidate of [o.raw, o.data, (o.data as { data?: unknown } | undefined)?.data]) {
    if (typeof candidate === "string" && isHex(candidate)) {
      const decoded = decodeRevertData(candidate);
      if (decoded) return decoded;
    }
  }

  // viem ContractFunctionRevertedError.data already decoded (e.g. raw missing)
  const data = o.data as { errorName?: unknown; args?: unknown } | undefined;
  if (typeof data === "object" && data !== null && isEscrowErrorName(data.errorName)) {
    const args: readonly unknown[] = Array.isArray(data.args) ? data.args : [];
    return { name: data.errorName, args, message: escrowErrorMessage(data.errorName, args) };
  }
  return null;
}

/**
 * Finds an escrow custom error in anything thrown by viem / wagmi
 * (`writeContract`, `simulateContract`, `estimateContractGas`, `readContract`),
 * in a JSON-RPC error object, or in a raw revert data hex string.
 *
 * Walks the `cause` chain (like viem's `BaseError.walk`) without relying on
 * `instanceof`, so errors from another viem copy (e.g. the frontend's) also work.
 * Returns `null` when no escrow error is found (user rejected the tx, network error,
 * insufficient funds, `Error(string)`/`Panic`, …); show a generic message then.
 */
export function decodeEscrowError(err: unknown): DecodedEscrowError | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0 && seen.size < 32) {
    const node = queue.shift();
    if (node === undefined || node === null || seen.has(node)) continue;
    seen.add(node);
    const decoded = fromNode(node);
    if (decoded) return decoded;
    if (typeof node === "object") {
      const o = node as { cause?: unknown; error?: unknown };
      queue.push(o.cause, o.error);
    }
  }
  return null;
}
