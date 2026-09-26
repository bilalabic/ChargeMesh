import { ref } from "vue";

export const walletAddress = ref<string | null>(null);

export function setWalletAddress(address: string | undefined) {
  walletAddress.value = address ?? null;
}

export function getWalletAddress() {
  return walletAddress.value;
}
