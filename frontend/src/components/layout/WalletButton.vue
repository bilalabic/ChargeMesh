<script setup lang="ts">
import { anvilLocal, monadTestnet, type AppConfig } from "@chargemesh/shared";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "@wagmi/vue";
import { computed, onMounted, ref, watchEffect } from "vue";
import { getApiClient } from "../../lib/api";
import { env } from "../../lib/env";
import { setWalletAddress, walletConnectionErrorMessage } from "../../lib/wallet";

const api = getApiClient();
const account = useAccount();
const connection = useConnect();
const disconnection = useDisconnect();
const networkSwitch = useSwitchChain();
const walletError = ref("");
const showInstallLink = ref(false);
const config = ref<AppConfig | null>(null);
const configError = ref("");
const loadingConfig = ref(true);

watchEffect(() => setWalletAddress(account.address.value));

const shortAddress = computed(() => {
  const address = account.address.value;
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Cüzdanı bağla";
});

const expectedChainId = computed(() => {
  const id = config.value?.chainId;
  return id === monadTestnet.id || id === anvilLocal.id ? id : undefined;
});
const expectedChainName = computed(() => {
  if (expectedChainId.value === monadTestnet.id) return monadTestnet.name;
  if (expectedChainId.value === anvilLocal.id) return anvilLocal.name;
  return "desteklenen ağ";
});
const isWrongNetwork = computed(
  () =>
    account.isConnected.value &&
    expectedChainId.value !== undefined &&
    account.chainId.value !== expectedChainId.value,
);
const configMismatch = computed(
  () => expectedChainId.value !== undefined && expectedChainId.value !== env.chainId,
);

async function loadConfig() {
  loadingConfig.value = true;
  configError.value = "";
  try {
    const result = await api.config();
    if (result.chainMode === "mock") {
      throw new Error("Backend mock zincir modunda. CHAIN_MODE değerini monad veya anvil yapın.");
    }
    if (result.chainId !== monadTestnet.id && result.chainId !== anvilLocal.id) {
      throw new Error(`Backend desteklenmeyen bir zincir bildirdi: ${result.chainId}`);
    }
    if (!result.contractAddress) {
      throw new Error("Backend sözleşme adresi bildirmedi.");
    }
    config.value = result;
  } catch (error) {
    config.value = null;
    configError.value =
      error instanceof Error && !/Network error/i.test(error.message)
        ? error.message
        : "Backend yapılandırması alınamadı. API'nin çalıştığını kontrol edin.";
  } finally {
    loadingConfig.value = false;
  }
}

async function connectWallet() {
  walletError.value = "";
  showInstallLink.value = false;
  if (!expectedChainId.value) {
    await loadConfig();
  }
  const chainId = expectedChainId.value;
  if (!chainId) return;
  const connector = connection.connectors[0];
  if (!connector) {
    walletError.value = "MetaMask bağlantısı hazırlanamadı. Sayfayı yenileyip tekrar deneyin.";
    return;
  }
  try {
    const result = await connection.connectAsync({ connector, chainId });
    if (result.chainId !== chainId) {
      walletError.value = `${expectedChainName.value} ağına geçiş tamamlanmadı.`;
    }
  } catch (error) {
    walletError.value = walletConnectionErrorMessage(error);
    showInstallLink.value = /MetaMask bulunamadı/.test(walletError.value);
  }
}

async function switchToExpectedNetwork() {
  const chainId = expectedChainId.value;
  if (!chainId) return;
  walletError.value = "";
  try {
    await networkSwitch.switchChainAsync({ chainId });
  } catch (error) {
    walletError.value = walletConnectionErrorMessage(error);
  }
}

function disconnectWallet() {
  walletError.value = "";
  disconnection.disconnect();
}

onMounted(loadConfig);
</script>

<template>
  <div class="relative flex items-center gap-2">
    <button
      v-if="isWrongNetwork"
      type="button"
      class="cursor-pointer rounded-lg bg-volt-400 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-volt-300 disabled:opacity-50"
      :disabled="networkSwitch.isPending.value"
      @click="switchToExpectedNetwork"
    >
      {{ networkSwitch.isPending.value ? "Ağ değişiyor…" : `${expectedChainName} ağına geç` }}
    </button>
    <button
      v-if="account.isConnected.value"
      type="button"
      class="cursor-pointer rounded-lg border border-ink-600 px-3 py-2 font-mono text-xs text-ink-100 hover:border-volt-400"
      title="MetaMask bağlantısını kes"
      @click="disconnectWallet"
    >
      {{ shortAddress }}
    </button>
    <button
      v-else
      type="button"
      class="cursor-pointer rounded-lg bg-volt-400 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-volt-300 disabled:opacity-50"
      :disabled="connection.isPending.value || loadingConfig"
      @click="connectWallet"
    >
      {{ loadingConfig ? "Backend bekleniyor…" : connection.isPending.value ? "MetaMask bekleniyor…" : "MetaMask'a bağlan" }}
    </button>
    <div
      v-if="walletError || configError || configMismatch"
      class="absolute right-0 top-[calc(100%+0.5rem)] w-72 rounded-lg border border-red-400/30 bg-ink-950/95 p-3 text-xs text-red-200 shadow-xl"
      role="alert"
    >
      {{ walletError || configError || `Backend ${expectedChainName} ağını kullanıyor; VITE_CHAIN_ID değerini ${expectedChainId} yapın.` }}
      <a
        v-if="showInstallLink"
        class="ml-1 font-semibold text-volt-300 underline"
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
      >MetaMask'ı indir</a>
    </div>
  </div>
</template>
