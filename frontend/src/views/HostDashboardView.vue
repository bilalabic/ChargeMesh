<script setup lang="ts">
import type { ChargerStatus, ChargingNode, Reservation } from "@chargemesh/shared";
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import PageShell from "../components/ui/PageShell.vue";
import NoticeBox from "../components/ui/NoticeBox.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import { getApiClient } from "../lib/api";
import { errorMessage, formatDateTime, formatEnergy } from "../lib/presentation";

const api = getApiClient();
const nodes = ref<ChargingNode[]>([]);
const reservations = ref<Reservation[]>([]);
const chargers = ref<ChargerStatus[]>([]);
const loading = ref(true);
const error = ref("");

const onlineCount = computed(() => nodes.value.filter((node) => node.online).length);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [nodes.value, chargers.value] = await Promise.all([api.listMyNodes(), api.chargers()]);
    reservations.value = (
      await Promise.all(nodes.value.map((node) => api.listNodeReservations(node.id)))
    ).flat();
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
    eyebrow="Host paneli"
    title="Şarj kapasitenizi yayınlayın"
    description="Node durumunu izleyin, uygun saatleri slot olarak açın ve gelen rezervasyonları tek yerden takip edin."
  >
    <template #actions>
      <RouterLink class="button-primary" to="/host/nodes/new">Yeni node</RouterLink>
    </template>

    <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>

    <div class="mb-8 grid gap-4 sm:grid-cols-3">
      <div class="metric-card"><span>Node</span><strong>{{ nodes.length }}</strong></div>
      <div class="metric-card"><span>Çevrimiçi</span><strong>{{ onlineCount }}</strong></div>
      <div class="metric-card"><span>Rezervasyon</span><strong>{{ reservations.length }}</strong></div>
    </div>

    <p v-if="loading" class="text-ink-400">Host verileri yükleniyor…</p>
    <div v-else-if="nodes.length" class="grid gap-5 lg:grid-cols-2">
      <RouterLink
        v-for="node in nodes"
        :key="node.id"
        :to="`/host/nodes/${node.id}`"
        class="group rounded-2xl border border-ink-700 bg-ink-900/60 p-6 transition hover:border-ember-400/60"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-mono text-xs text-ink-400">{{ node.ocppChargePointId }}</p>
            <h2 class="mt-2 text-xl font-semibold text-ink-50 group-hover:text-ember-300">{{ node.name }}</h2>
            <p class="mt-1 text-sm text-ink-400">{{ node.areaLabel }}</p>
          </div>
          <StatusBadge :status="node.online ? 'OPEN' : 'FAILED'" />
        </div>
        <div class="mt-6 grid grid-cols-2 gap-3 text-sm text-ink-300">
          <span>{{ node.connectorType }} · {{ node.maxPowerKw }} kW</span>
          <span class="text-right">Konnektör {{ node.ocppConnectorId }}</span>
        </div>
        <p class="mt-5 border-t border-ink-800 pt-4 text-xs text-ink-500">
          Cihaz: {{ chargers.find((item) => item.chargePointId === node.ocppChargePointId)?.connectorStatus ?? "Bilinmiyor" }}
        </p>
      </RouterLink>
    </div>
    <div v-else-if="!loading" class="empty-card">
      <h2 class="text-xl font-semibold text-ink-100">Henüz node yok</h2>
      <p class="mt-2 text-ink-400">İlk şarj noktanızı ekleyerek başlayın.</p>
    </div>

    <section v-if="reservations.length" class="mt-12">
      <h2 class="mb-5 text-2xl font-semibold text-ink-50">Son rezervasyonlar</h2>
      <div class="overflow-hidden rounded-2xl border border-ink-800">
        <div v-for="reservation in reservations" :key="reservation.id" class="flex flex-col gap-3 border-b border-ink-800 bg-ink-900/40 p-5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium text-ink-100">{{ reservation.node.name }}</p>
            <p class="mt-1 text-sm text-ink-400">{{ formatDateTime(reservation.window.startsAt) }} · {{ formatEnergy(reservation.requestedWh) }}</p>
          </div>
          <StatusBadge :status="reservation.status" />
        </div>
      </div>
    </section>
  </PageShell>
</template>
