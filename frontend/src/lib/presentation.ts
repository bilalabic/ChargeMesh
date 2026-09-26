import { formatMon, whToKwh } from "@chargemesh/shared";

const statusLabels: Record<string, string> = {
  OPEN: "Açık",
  HELD: "Bekletiliyor",
  RESERVED: "Rezerve",
  CLOSED: "Kapalı",
  PENDING_PAYMENT: "Ödeme bekleniyor",
  HOLD_EXPIRED: "Teklif süresi doldu",
  CONFIRMED: "Onaylandı",
  ACTIVE: "Aktif",
  COMPLETED: "Tamamlandı",
  SETTLED: "Hesaplaştı",
  CANCELLED: "İptal edildi",
  EXPIRED: "Süresi doldu",
  FAILED: "Hata",
  STARTING: "Başlatılıyor",
  CHARGING: "Şarj oluyor",
  STOPPING: "Durduruluyor",
  SETTLING: "Hesaplanıyor",
};

export const statusLabel = (status: string) => statusLabels[status] ?? status;

export function statusTone(status: string) {
  if (["OPEN", "CONFIRMED", "CHARGING", "SETTLED"].includes(status)) return "success";
  if (["FAILED", "HOLD_EXPIRED", "CANCELLED", "EXPIRED"].includes(status)) return "danger";
  if (["HELD", "PENDING_PAYMENT", "STARTING", "STOPPING", "SETTLING"].includes(status)) return "warning";
  return "neutral";
}

export const formatDateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso))
    : "—";

export const formatEnergy = (wh: number) => `${whToKwh(wh).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} kWh`;

export const formatWei = (wei: string) => formatMon(BigInt(wei));

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu.";
}

export function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
