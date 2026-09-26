<script setup lang="ts">
import { useAccount, useConnect, useDisconnect } from "@wagmi/vue";
import { computed, watchEffect } from "vue";
import { env } from "../../lib/env";
import { setWalletAddress } from "../../lib/wallet";

const account = useAccount();
const connection = useConnect();
const disconnection = useDisconnect();

watchEffect(() => setWalletAddress(account.address.value));

const shortAddress = computed(() => {
  const address = account.address.value;
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Cüzdanı bağla";
});

function connectWallet() {
  const connector = connection.connectors[0];
  if (connector) connection.connect({ connector });
}
</script>

<template>
  <span
    v-if="env.apiMode === 'mock'"
    class="rounded-lg bg-volt-400 px-3 py-2 text-xs font-semibold text-ink-950"
  >
    Demo modu
  </span>
  <button
    v-else-if="account.isConnected.value"
    type="button"
    class="cursor-pointer rounded-lg border border-ink-600 px-3 py-2 font-mono text-xs text-ink-100 hover:border-volt-400"
    title="Cüzdan bağlantısını kes"
    @click="disconnection.disconnect()"
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
    {{ connection.isPending.value ? "Bağlanıyor…" : "Cüzdanı bağla" }}
  </button>
</template>
