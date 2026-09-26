<script setup lang="ts">
import { monadTestnet } from "@chargemesh/shared";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "@wagmi/vue";
import { computed, ref, watchEffect } from "vue";
import { env } from "../../lib/env";
import { setWalletAddress, walletConnectionErrorMessage } from "../../lib/wallet";

const account = useAccount();
const connection = useConnect();
const disconnection = useDisconnect();
const networkSwitch = useSwitchChain();
const walletError = ref("");
const showInstallLink = ref(false);

watchEffect(() => setWalletAddress(account.address.value));

const shortAddress = computed(() => {
  const address = account.address.value;
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Cüzdanı bağla";
});

const expectedChainName = computed(() =>
  env.chainId === monadTestnet.id ? monadTestnet.name : "Yerel Anvil",
);
const isWrongNetwork = computed(
  () => account.isConnected.value && account.chainId.value !== env.chainId,
);

async function connectWallet() {
  walletError.value = "";
  showInstallLink.value = false;
  const connector = connection.connectors[0];
  if (!connector) {
    walletError.value = "MetaMask bağlantısı hazırlanamadı. Sayfayı yenileyip tekrar deneyin.";
    return;
  }
  try {
    const result = await connection.connectAsync({ connector, chainId: env.chainId });
    if (result.chainId !== env.chainId) {
      walletError.value = `${expectedChainName.value} ağına geçiş tamamlanmadı.`;
    }
  } catch (error) {
    walletError.value = walletConnectionErrorMessage(error);
    showInstallLink.value = /MetaMask bulunamadı/.test(walletError.value);
  }
}

async function switchToExpectedNetwork() {
  walletError.value = "";
  try {
    await networkSwitch.switchChainAsync({ chainId: env.chainId });
  } catch (error) {
    walletError.value = walletConnectionErrorMessage(error);
  }
}

function disconnectWallet() {
  walletError.value = "";
  disconnection.disconnect();
}
</script>

<template>
  <span
    v-if="env.apiMode === 'mock'"
    class="rounded-lg bg-volt-400 px-3 py-2 text-xs font-semibold text-ink-950"
  >
    Demo modu
  </span>
  <div v-else class="relative flex items-center gap-2">
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
      :disabled="connection.isPending.value"
      @click="connectWallet"
    >
      {{ connection.isPending.value ? "MetaMask bekleniyor…" : "MetaMask'a bağlan" }}
    </button>
    <div
      v-if="walletError"
      class="absolute right-0 top-[calc(100%+0.5rem)] w-72 rounded-lg border border-red-400/30 bg-ink-950/95 p-3 text-xs text-red-200 shadow-xl"
      role="alert"
    >
      {{ walletError }}
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
