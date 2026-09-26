<script setup lang="ts">
import type { AppConfig, ChargeIntent, MatchResult } from "@chargemesh/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import type { Address, Hex } from "viem";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import { transactionErrorMessage, useEscrowTransactions } from "../composables/useEscrowTransactions";
import { getApiClient } from "../lib/api";
import { errorMessage, formatDateTime, formatEnergy, formatWei } from "../lib/presentation";

const api = getApiClient();
const route = useRoute();
const router = useRouter();
const escrow = useEscrowTransactions();
const intentId = computed(() => String(route.params.intentId));
const intent = ref<ChargeIntent | null>(null);
const matches = ref<MatchResult[]>([]);
const config = ref<AppConfig | null>(null);
const loading = ref(true);
const reservingSlotId = ref("");
const error = ref("");
const notice = ref("");

const MOCK_TX_HASH = `0x${"12".repeat(32)}` as Hex;

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [intentResult, matchResult, configResult] = await Promise.all([
      api.getIntent(intentId.value),
      api.getMatches(intentId.value),
      api.config(),
    ]);
    intent.value = intentResult;
    matches.value = matchResult.matches;
    config.value = configResult;
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}

async function reserve(match: MatchResult) {
  reservingSlotId.value = match.slotId;
  error.value = "";
  notice.value = "Teklif hazırlanıyor…";
  try {
    const created = await api.createReservation({ intentId: intentId.value, slotId: match.slotId });
    let txHash: Hex = MOCK_TX_HASH;
    if (config.value?.chainMode !== "mock") {
      if (created.chainId !== 10143 && created.chainId !== 31337) {
        throw new Error(`Desteklenmeyen zincir: ${created.chainId}`);
      }
      notice.value = "Cüzdan onayı bekleniyor…";
      txHash = await escrow.reserve({
        chainId: created.chainId,
        contractAddress: created.contractAddress as Address,
        quote: created.quote,
        signature: created.signature as Hex,
      });
    }
    notice.value = "İşlem doğrulanıyor…";
    const confirmed = await api.confirmReservation(created.reservation.id, { txHash });
    await router.push(`/driver/reservations/${confirmed.id}`);
  } catch (cause) {
    error.value = config.value?.chainMode === "mock" ? errorMessage(cause) : transactionErrorMessage(cause);
    notice.value = "";
  } finally {
    reservingSlotId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <PageShell
    eyebrow="Sürücü · Eşleşmeler"
    title="Uygun şarj noktaları"
    :description="intent ? `${formatEnergy(intent.requestedWh)} enerji · ${intent.radiusKm} km yarıçap · ${formatDateTime(intent.arriveAt)}` : 'Talebinize uygun slotlar sıralanıyor.'"
  >
    <template #actions><RouterLink class="button-secondary" to="/driver">Talebi değiştir</RouterLink></template>
    <div class="space-y-4">
      <NoticeBox v-if="notice">{{ notice }}</NoticeBox>
      <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    </div>
    <p v-if="loading" class="mt-6 text-ink-400">Eşleşmeler hazırlanıyor…</p>
    <div v-else-if="matches.length" class="mt-6 space-y-5">
      <article v-for="match in matches" :key="match.slotId" class="rounded-2xl border border-ink-700 bg-ink-900/60 p-6 sm:p-7">
        <div class="grid gap-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <div class="flex h-12 w-12 items-center justify-center rounded-full border border-volt-400/30 bg-volt-400/10 font-mono text-volt-300">#{{ match.rank }}</div>
          <div>
            <div class="flex flex-wrap items-center gap-3">
              <h2 class="text-xl font-semibold text-ink-50">{{ match.node.name }}</h2>
              <span v-if="match.fullyCovers" class="rounded-full bg-volt-400/10 px-2.5 py-1 text-xs text-volt-300">İhtiyacı karşılıyor</span>
            </div>
            <p class="mt-2 text-sm text-ink-400">{{ match.node.areaLabel }} · {{ match.distanceKm.toLocaleString('tr-TR') }} km · {{ match.node.connectorType }}</p>
            <div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-200">
              <span>{{ formatEnergy(match.quotedWh) }} karşılanabilir</span>
              <span>{{ formatDateTime(match.window.startsAt) }} → {{ formatDateTime(match.window.endsAt) }}</span>
            </div>
          </div>
          <div class="min-w-44 lg:text-right">
            <p class="text-xs uppercase tracking-wider text-ink-500">Depozito</p>
            <p class="mt-1 text-xl font-semibold text-ink-50">{{ formatWei(match.depositWei) }}</p>
            <button class="button-primary mt-4 w-full justify-center" type="button" :disabled="Boolean(reservingSlotId)" @click="reserve(match)">
              {{ reservingSlotId === match.slotId ? "Rezerve ediliyor…" : "Rezerve et" }}
            </button>
          </div>
        </div>
      </article>
    </div>
    <div v-else-if="!loading" class="empty-card mt-6">
      <h2 class="text-xl font-semibold text-ink-100">Uygun slot bulunamadı</h2>
      <p class="mt-2 text-ink-400">Zaman aralığını veya arama yarıçapını genişleterek yeniden deneyin.</p>
    </div>
  </PageShell>
</template>
