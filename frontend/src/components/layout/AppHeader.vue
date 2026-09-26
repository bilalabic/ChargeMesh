<script setup lang="ts">
import { chargeMeshEscrowAbi, formatMon } from "@chargemesh/shared";
import { useAccount, useReadContract } from "@wagmi/vue";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import type { Address } from "viem";
import NoticeBox from "../ui/NoticeBox.vue";
import { transactionErrorMessage, useEscrowTransactions } from "../../composables/useEscrowTransactions";
import { getApiClient } from "../../lib/api";
import BrandMark from "./BrandMark.vue";
import WalletButton from "./WalletButton.vue";

const links = [
  { to: "/host", label: "Host" },
  { to: "/driver", label: "Sürücü" },
];

const api = getApiClient();
const account = useAccount();
const escrow = useEscrowTransactions();
const config = ref<Awaited<ReturnType<typeof api.config>> | null>(null);
const withdrawalError = ref("");
const withdrawing = ref(false);
const chainId = computed(() => {
  const id = config.value?.chainId;
  return id === 10143 || id === 31337 ? id : undefined;
});
const contractAddress = computed(() => config.value?.contractAddress as Address | undefined);
const isLiveChain = computed(
  () => config.value?.chainMode === "monad" || config.value?.chainMode === "anvil",
);
const pendingQuery = useReadContract(
  computed({
    get: () => ({
      address: contractAddress.value,
      abi: chargeMeshEscrowAbi,
      functionName: "pendingWithdrawal" as const,
      args: account.address.value ? [account.address.value] : undefined,
      chainId: chainId.value,
      query: {
        enabled: Boolean(
          isLiveChain.value &&
            contractAddress.value &&
            chainId.value &&
            account.address.value,
        ),
      },
    }),
    set: () => undefined,
  }),
);
const hasPendingWithdrawal = computed(
  () => typeof pendingQuery.data.value === "bigint" && pendingQuery.data.value > 0n,
);
const pendingAmount = computed(() => (typeof pendingQuery.data.value === "bigint" ? pendingQuery.data.value : 0n));

async function loadConfig() {
  try {
    config.value = await api.config();
  } catch {
    // The header stays usable while the API is unavailable.
  }
}

async function withdraw() {
  if (!chainId.value || !contractAddress.value) return;
  withdrawing.value = true;
  withdrawalError.value = "";
  try {
    await escrow.withdraw({ chainId: chainId.value, contractAddress: contractAddress.value });
    await pendingQuery.refetch();
  } catch (cause) {
    withdrawalError.value = transactionErrorMessage(cause);
  } finally {
    withdrawing.value = false;
  }
}

onMounted(loadConfig);
</script>

<template>
  <header class="fixed inset-x-4 top-4 z-50 sm:inset-x-6">
    <div
      class="mx-auto flex max-w-6xl items-center justify-between rounded-xl border border-ink-700/70 bg-ink-950/70 px-4 py-3 backdrop-blur-md sm:px-5"
    >
      <RouterLink to="/" class="flex items-center gap-2.5 font-semibold text-ink-50">
        <BrandMark />
        ChargeMesh
      </RouterLink>

      <div class="flex items-center gap-3">
        <nav class="hidden items-center gap-5 md:flex" aria-label="Ana menü">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="cursor-pointer text-sm text-ink-300 transition-colors hover:text-ink-50"
          >
            {{ link.label }}
          </RouterLink>
        </nav>
        <WalletButton />
      </div>
    </div>
    <div
      v-if="hasPendingWithdrawal"
      class="mx-auto mt-2 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-volt-400/30 bg-ink-950/90 px-4 py-3 text-sm shadow-lg backdrop-blur-md"
    >
      <span class="text-ink-100">Bekleyen ödemeniz var: {{ formatMon(pendingAmount) }}</span>
      <button class="button-primary" type="button" :disabled="withdrawing" @click="withdraw">
        {{ withdrawing ? "Çekiliyor…" : "Ödemeyi çek" }}
      </button>
    </div>
    <div v-if="withdrawalError" class="mx-auto mt-2 max-w-6xl">
      <NoticeBox kind="error">{{ withdrawalError }}</NoticeBox>
    </div>
  </header>
</template>
