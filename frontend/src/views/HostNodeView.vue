<script setup lang="ts">
import type { ChargingNode, EnergySlot, Reservation } from "@chargemesh/shared";
import QRCode from "qrcode";
import { parseEther } from "viem";
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import { getApiClient } from "../lib/api";
import { errorMessage, formatDateTime, formatEnergy, formatWei, toLocalInput } from "../lib/presentation";

const api = getApiClient();
const route = useRoute();
const nodeId = computed(() => String(route.params.nodeId));
const node = ref<ChargingNode | null>(null);
const slots = ref<EnergySlot[]>([]);
const reservations = ref<Reservation[]>([]);
const qrDataUrl = ref("");
const loading = ref(true);
const saving = ref(false);
const error = ref("");

const initialStart = new Date(Date.now() + 30 * 60_000);
const form = reactive({
  startsAt: toLocalInput(initialStart),
  endsAt: toLocalInput(new Date(initialStart.getTime() + 4 * 3_600_000)),
  maxEnergyKwh: 40,
  priceMon: "0.01",
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const result = await api.getNode(nodeId.value);
    if (!("startUrl" in result)) throw new Error("Bu node'un özel ayrıntılarını görme yetkiniz yok.");
    node.value = result;
    [slots.value, reservations.value] = await Promise.all([
      api.listSlots(nodeId.value),
      api.listNodeReservations(nodeId.value),
    ]);
    qrDataUrl.value = await QRCode.toDataURL(result.startUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#08090a", light: "#cbff3e" },
    });
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}

async function createSlot() {
  saving.value = true;
  error.value = "";
  try {
    await api.createSlot(nodeId.value, {
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      maxEnergyWh: Math.round(form.maxEnergyKwh * 1000),
      pricePerKwhWei: parseEther(form.priceMon).toString(),
    });
    await load();
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}

async function closeSlot(slot: EnergySlot) {
  error.value = "";
  try {
    await api.closeSlot(slot.id);
    await load();
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

onMounted(load);
</script>

<template>
  <PageShell
    eyebrow="Host · Node"
    :title="node?.name ?? 'Node yükleniyor'"
    :description="node ? `${node.areaLabel} · ${node.connectorType} · ${node.maxPowerKw} kW` : undefined"
  >
    <template #actions><RouterLink class="button-secondary" to="/host">Host paneli</RouterLink></template>
    <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    <p v-if="loading" class="text-ink-400">Node ayrıntıları yükleniyor…</p>

    <div v-else-if="node" class="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div class="space-y-10">
        <section>
          <div class="mb-5 flex items-center justify-between">
            <h2 class="text-2xl font-semibold text-ink-50">Energy slot'ları</h2>
            <span class="text-sm text-ink-400">{{ slots.length }} kayıt</span>
          </div>
          <div v-if="slots.length" class="space-y-3">
            <article v-for="slot in slots" :key="slot.id" class="rounded-xl border border-ink-800 bg-ink-900/50 p-5">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p class="font-medium text-ink-100">{{ formatDateTime(slot.startsAt) }} → {{ formatDateTime(slot.endsAt) }}</p>
                  <p class="mt-2 text-sm text-ink-400">{{ formatEnergy(slot.maxEnergyWh) }} · {{ formatWei(slot.pricePerKwhWei) }}/kWh</p>
                </div>
                <div class="flex items-center gap-3">
                  <StatusBadge :status="slot.status" />
                  <button v-if="slot.status === 'OPEN'" class="text-button" type="button" @click="closeSlot(slot)">Kapat</button>
                </div>
              </div>
            </article>
          </div>
          <div v-else class="empty-card">Henüz yayınlanmış slot yok.</div>
        </section>

        <section class="rounded-2xl border border-ink-700 bg-ink-900/60 p-6">
          <h2 class="text-2xl font-semibold text-ink-50">Yeni slot yayınla</h2>
          <form class="mt-6 form-grid" @submit.prevent="createSlot">
            <label class="field"><span>Başlangıç</span><input v-model="form.startsAt" type="datetime-local" required /></label>
            <label class="field"><span>Bitiş</span><input v-model="form.endsAt" type="datetime-local" required /></label>
            <label class="field"><span>Maksimum enerji (kWh)</span><input v-model.number="form.maxEnergyKwh" type="number" min="1" max="200" step="0.1" required /></label>
            <label class="field"><span>Fiyat (MON/kWh)</span><input v-model="form.priceMon" inputmode="decimal" required /></label>
            <button class="button-primary justify-center sm:col-span-2" type="submit" :disabled="saving">{{ saving ? "Yayınlanıyor…" : "Slot'u yayınla" }}</button>
          </form>
        </section>

        <section>
          <h2 class="mb-5 text-2xl font-semibold text-ink-50">Gelen rezervasyonlar</h2>
          <div v-if="reservations.length" class="space-y-3">
            <article v-for="reservation in reservations" :key="reservation.id" class="flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/50 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><p class="text-ink-100">{{ formatEnergy(reservation.requestedWh) }}</p><p class="mt-1 text-sm text-ink-400">{{ formatDateTime(reservation.window.startsAt) }}</p></div>
              <StatusBadge :status="reservation.status" />
            </article>
          </div>
          <div v-else class="empty-card">Henüz rezervasyon yok.</div>
        </section>
      </div>

      <aside class="h-fit rounded-2xl border border-ember-400/30 bg-ember-400/[0.06] p-6 text-center lg:sticky lg:top-28">
        <p class="font-mono text-xs uppercase tracking-wider text-ember-300">Başlatma QR'ı</p>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="Şarj başlatma QR kodu" class="mx-auto mt-5 w-full max-w-60 rounded-xl" />
        <p class="mt-4 break-all font-mono text-xs text-ink-400">{{ node.startUrl }}</p>
        <p class="mt-4 text-sm text-ink-300">Sürücü bu QR kodunu tarayarak veya rezervasyon ekranını kullanarak şarjı başlatabilir.</p>
      </aside>
    </div>
  </PageShell>
</template>
