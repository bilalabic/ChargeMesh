<script setup lang="ts">
import { computeSessionHash, type ProofResponse, type Reservation } from "@chargemesh/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import { getApiClient } from "../lib/api";
import { errorMessage, formatDateTime, formatEnergy, formatWei } from "../lib/presentation";

const api = getApiClient();
const route = useRoute();
const reservationId = computed(() => String(route.params.id));
const reservation = ref<Reservation | null>(null);
const proof = ref<ProofResponse | null>(null);
const loading = ref(true);
const error = ref("");
const browserHash = computed(() => (proof.value ? computeSessionHash(proof.value.summary) : null));
const browserVerified = computed(
  () => Boolean(proof.value?.onchain && browserHash.value === proof.value.onchain.sessionHash),
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [reservation.value, proof.value] = await Promise.all([
      api.getReservation(reservationId.value),
      api.getProof(reservationId.value),
    ]);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <PageShell
    eyebrow="Proof of Charge"
    title="Ölçülen enerji, doğrulanabilir kayıt"
    description="Sayaç özeti tarayıcıda yeniden hash'lenir ve zincirdeki oturum kaydıyla karşılaştırılır."
  >
    <template #actions><RouterLink class="button-secondary" :to="`/driver/reservations/${reservationId}`">Rezervasyona dön</RouterLink></template>
    <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    <p v-if="loading" class="text-ink-400">Proof hazırlanıyor…</p>
    <div v-else-if="proof && reservation" class="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div class="space-y-6">
        <NoticeBox :kind="browserVerified ? 'success' : 'error'">
          {{ browserVerified ? "Zincirdeki kayıtla eşleşiyor ✓" : proof.onchain ? "Hash eşleşmiyor" : "Hesaplaşma bekleniyor" }}
        </NoticeBox>
        <section class="rounded-2xl border border-ink-700 bg-ink-900/60 p-6">
          <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div><p class="meta-label">Talep</p><p class="meta-value">{{ formatEnergy(proof.summary.requestedWh) }}</p></div>
            <div><p class="meta-label">Aktarılan</p><p class="meta-value">{{ formatEnergy(proof.summary.deliveredWh) }}</p></div>
            <div><p class="meta-label">Faturalanan</p><p class="meta-value">{{ formatEnergy(proof.onchain?.billableWh ?? 0) }}</p></div>
            <div><p class="meta-label">Host'a</p><p class="meta-value">{{ proof.onchain ? formatWei(proof.onchain.hostAmountWei) : '—' }}</p></div>
            <div><p class="meta-label">İade</p><p class="meta-value">{{ proof.onchain ? formatWei(proof.onchain.refundWei) : '—' }}</p></div>
            <div><p class="meta-label">Örnek sayısı</p><p class="meta-value">{{ proof.summary.meterSamples.count }}</p></div>
          </div>
        </section>
        <section class="rounded-2xl border border-ink-800 bg-black/30 p-6">
          <h2 class="text-lg font-semibold text-ink-50">Kanonik JSON</h2>
          <pre class="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-ink-300">{{ proof.canonicalJson }}</pre>
        </section>
      </div>
      <aside class="h-fit rounded-2xl border border-volt-400/25 bg-volt-400/[0.05] p-6 lg:sticky lg:top-28">
        <p class="font-mono text-xs uppercase tracking-wider text-volt-300">Oturum özeti</p>
        <dl class="mt-5 space-y-4 text-sm">
          <div><dt class="text-ink-500">Başlangıç</dt><dd class="mt-1 text-ink-100">{{ formatDateTime(proof.summary.startedAt) }}</dd></div>
          <div><dt class="text-ink-500">Bitiş</dt><dd class="mt-1 text-ink-100">{{ formatDateTime(proof.summary.stoppedAt) }}</dd></div>
          <div><dt class="text-ink-500">Durma nedeni</dt><dd class="mt-1 text-ink-100">{{ proof.summary.stopReason }}</dd></div>
          <div><dt class="text-ink-500">Tarayıcı hash'i</dt><dd class="mt-1 break-all font-mono text-xs text-ink-300">{{ browserHash }}</dd></div>
          <div><dt class="text-ink-500">Zincir hash'i</dt><dd class="mt-1 break-all font-mono text-xs text-ink-300">{{ proof.onchain?.sessionHash ?? 'Bekliyor' }}</dd></div>
        </dl>
      </aside>
    </div>
  </PageShell>
</template>
