import { ref } from "vue";

export const walletAddress = ref<string | null>(null);

export function setWalletAddress(address: string | undefined) {
  walletAddress.value = address ?? null;
}

export function getWalletAddress() {
  return walletAddress.value;
}

export function walletConnectionErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/ProviderNotFound|provider not found/i.test(`${name} ${message}`)) {
    return "MetaMask bulunamadı. Tarayıcı eklentisini kurup sayfayı yenileyin.";
  }
  if (/UserRejected|rejected|denied|4001/i.test(`${name} ${message}`)) {
    return "MetaMask bağlantı veya ağ değiştirme isteği iptal edildi.";
  }
  if (/ResourceUnavailable|already pending|-32002/i.test(`${name} ${message}`)) {
    return "MetaMask'ta bekleyen bir istek var. Eklentiyi açıp isteği tamamlayın.";
  }
  return "MetaMask bağlantısı kurulamadı. Eklentiyi, seçili ağı ve kilit durumunu kontrol edin.";
}
