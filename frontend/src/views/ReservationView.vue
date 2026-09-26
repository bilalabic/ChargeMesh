<script setup lang="ts">
import {
  SESSION_SSE_EVENTS,
  type AppConfig,
  type ChargingSession,
  type Reservation,
} from "@chargemesh/shared";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import type { Address, Hex } from "viem";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import { transactionErrorMessage, useEscrowTransactions } from "../composables/useEscrowTransactions";
import { getApiClient } from "../lib/api";
import { getWalletAddress } from "../lib/wallet";
import { errorMessage, formatDateTime, formatEnergy, formatWei } from "../lib/presentation";

const SETTLEMENT_GRACE_MS = 24 * 3_600_000;
const api = getApiClient();
const route = useRoute();
const escrow = useEscrowTransactions();
const reservationId = computed(() => String(route.params.id));
const reservation = ref<Reservation | null>(null);
const session = ref<ChargingSession | null>(null);
const config = ref<AppConfig | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;
let eventSource: EventSource | null = null;

const progress = computed(() => {
  if (!session.value || session.value.requestedWh <= 0) return 0;
  return Math.min(100, Math.round((session.value.deliveredWh / session.value.requestedWh) * 100));
});
const canStart = computed(() => reservation.value?.status === "CONFIRMED" && !reservation.value.sessionId);
const canStop = computed(() => ["STARTING", "CHARGING"].includes(session.value?.status ?? ""));
const canCancel = computed(
  () => reservation.value?.status === "CONFIRMED" && Date.now() < Date.parse(reservation.value.window.startsAt),
);
const canExpire = computed(() => {
  const item = reservation.value;
  if (!item) return false;
  const end = Date.parse(item.window.endsAt);
  if (item.status === "CONFIRMED") return Date.now() > end;
  return ["ACTIVE", "COMPLETED", "FAILED"].includes(item.status) && Date.now() > end + SETTLEMENT_GRACE_MS;
});
const chainReady = computed(
  () =>
    (config.value?.chainMode === "monad" || config.value?.chainMode === "anvil") &&
    Boolean(config.value.contractAddress) &&
    (config.value.chainId === 10143 || config.value.chainId === 31337),
);

async function refresh() {
  try {
    reservation.value = await api.getReservation(reservationId.value);
    if (reservation.value.sessionId) {
      session.value = await api.getSession(reservation.value.sessionId);
    }
  } catch (cause) {
    error.value = errorMessage(cause);
  }
}

function stopUpdates() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  eventSource?.close();
  eventSource = null;
}

function startUpdates() {
  stopUpdates();
  const current = session.value;
  if (!current || current.status === "SETTLED") return;
  const wallet = getWalletAddress();
  const eventsUrl = wallet ? api.sessionEventsUrl(current.id, wallet) : null;
  if (eventsUrl) {
    eventSource = new EventSource(eventsUrl);
    for (const eventName of [SESSION_SSE_EVENTS.sessionUpdated, SESSION_SSE_EVENTS.meter, SESSION_SSE_EVENTS.settled]) {
      eventSource.addEventListener(eventName, () => void refresh());
    }
    eventSource.addEventListener(SESSION_SSE_EVENTS.error, (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { message?: string };
        error.value = payload.message ?? "Oturum sırasında hata oluştu.";
      } catch {
        error.value = "Oturum sırasında hata oluştu.";
      }
    });
  } else {
    pollTimer = setInterval(() => void refresh(), 1000);
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    config.value = await api.config();
    await refresh();
    startUpdates();
  } finally {
    loading.value = false;
  }
}

async function startSession() {
  const item = reservation.value;
  if (!item) return;
  busy.value = true;
  error.value = "";
  notice.value = "Şarj cihazına başlatma komutu gönderiliyor…";
  try {
    session.value = await api.startSession({
      chargePointId: item.node.ocppChargePointId,
      connectorId: item.node.ocppConnectorId,
      reservationId: item.id,
    });
    reservation.value = await api.getReservation(item.id);
    notice.value = "Oturum başladı. Sayaç verileri bekleniyor.";
    startUpdates();
  } catch (cause) {
    error.value = errorMessage(cause);
    notice.value = "";
  } finally {
    busy.value = false;
  }
}

async function stopSession() {
  if (!session.value) return;
  busy.value = true;
  error.value = "";
  try {
    session.value = await api.stopSession(session.value.id);
    notice.value = "Durdurma komutu gönderildi; Proof of Charge hazırlanıyor.";
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}

async function chainAction(functionName: "cancel" | "expire") {
  const item = reservation.value;
  const currentConfig = config.value;
  if (!item || !currentConfig?.contractAddress) return;
  if (currentConfig.chainId !== 10143 && currentConfig.chainId !== 31337) return;
  busy.value = true;
  error.value = "";
  try {
    const hash = await escrow.simpleWrite({
      chainId: currentConfig.chainId,
      contractAddress: currentConfig.contractAddress as Address,
      functionName,
      reservationId: item.onchainId as Hex,
    });
    reservation.value = await api.syncReservation(item.id, { txHash: hash });
  } catch (cause) {
    error.value = transactionErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
onBeforeUnmount(stopUpdates);
</script>

<template>
  <PageShell
    eyebrow="Sürücü · Rezervasyon"
    :title="reservation?.node.name ?? 'Rezervasyon yükleniyor'"
    :description="reservation ? `${reservation.node.areaLabel} · ${formatEnergy(reservation.requestedWh)}` : undefined"
  >
    <template #actions>
      <RouterLink class="button-secondary" to="/driver">Yeni arama</RouterLink>
      <RouterLink v-if="reservation?.status === 'SETTLED'" class="button-primary" :to="`/reservations/${reservation.id}/proof`">Proof of Charge</RouterLink>
    </template>
    <div class="space-y-4">
      <NoticeBox v-if="notice">{{ notice }}</NoticeBox>
      <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    </div>
    <p v-if="loading" class="mt-6 text-ink-400">Rezervasyon yükleniyor…</p>

    <div v-else-if="reservation" class="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
      <div class="space-y-8">
        <section class="rounded-2xl border border-ink-700 bg-ink-900/60 p-6">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div><p class="text-sm text-ink-400">Rezervasyon durumu</p><h2 class="mt-2 text-2xl font-semibold text-ink-50">{{ formatDateTime(reservation.window.startsAt) }}</h2></div>
            <StatusBadge :status="reservation.status" />
          </div>
          <div class="mt-6 grid gap-4 border-t border-ink-800 pt-6 sm:grid-cols-3">
            <div><p class="meta-label">Enerji</p><p class="meta-value">{{ formatEnergy(reservation.requestedWh) }}</p></div>
            <div><p class="meta-label">Depozito</p><p class="meta-value">{{ formatWei(reservation.depositWei) }}</p></div>
            <div><p class="meta-label">Bitiş</p><p class="meta-value">{{ formatDateTime(reservation.window.endsAt) }}</p></div>
          </div>
        </section>

        <section v-if="reservation.access" class="rounded-2xl border border-volt-400/25 bg-volt-400/[0.05] p-6">
          <p class="font-mono text-xs uppercase tracking-wider text-volt-300">Erişim bilgileri</p>
          <h2 class="mt-3 text-xl font-semibold text-ink-50">{{ reservation.access.addressLine }}</h2>
          <p class="mt-3 text-ink-300">{{ reservation.access.accessInstructions }}</p>
        </section>

        <section v-if="session" class="rounded-2xl border border-ink-700 bg-ink-900/60 p-6">
          <div class="flex items-center justify-between gap-4"><h2 class="text-2xl font-semibold text-ink-50">Canlı oturum</h2><StatusBadge :status="session.status" /></div>
          <div class="mt-7">
            <div class="flex items-end justify-between"><span class="text-4xl font-semibold text-volt-300">{{ formatEnergy(session.deliveredWh) }}</span><span class="text-sm text-ink-400">{{ progress }}%</span></div>
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-ink-800"><div class="h-full rounded-full bg-volt-400 transition-all" :style="{ width: `${progress}%` }"></div></div>
            <div class="mt-5 grid grid-cols-2 gap-4 text-sm"><div><p class="meta-label">Güç</p><p class="meta-value">{{ (session.powerW / 1000).toLocaleString('tr-TR') }} kW</p></div><div><p class="meta-label">İşlem</p><p class="meta-value">#{{ session.ocppTransactionId ?? '—' }}</p></div></div>
          </div>
        </section>

        <div class="flex flex-wrap gap-3">
          <button v-if="canStart" class="button-primary" type="button" :disabled="busy" @click="startSession">Şarjı başlat</button>
          <button v-if="canStop" class="button-secondary" type="button" :disabled="busy" @click="stopSession">Şarjı durdur</button>
          <button v-if="canCancel && chainReady" class="button-danger" type="button" :disabled="busy" @click="chainAction('cancel')">Rezervasyonu iptal et</button>
          <button v-if="canExpire && chainReady" class="button-danger" type="button" :disabled="busy" @click="chainAction('expire')">Depozitoyu geri al</button>
        </div>
      </div>

      <aside class="h-fit rounded-2xl border border-ink-800 bg-ink-900/40 p-6 lg:sticky lg:top-28">
        <h2 class="text-lg font-semibold text-ink-50">İşlem kayıtları</h2>
        <dl class="mt-5 space-y-4 text-sm">
          <div><dt class="text-ink-500">Reserve</dt><dd class="mt-1 break-all font-mono text-xs text-ink-300">{{ reservation.txs.reserve ?? 'Bekliyor' }}</dd></div>
          <div><dt class="text-ink-500">Start</dt><dd class="mt-1 break-all font-mono text-xs text-ink-300">{{ reservation.txs.start ?? 'Bekliyor' }}</dd></div>
          <div><dt class="text-ink-500">Settle</dt><dd class="mt-1 break-all font-mono text-xs text-ink-300">{{ reservation.txs.settle ?? 'Bekliyor' }}</dd></div>
        </dl>
        <div v-if="reservation.settlement" class="mt-6 border-t border-ink-800 pt-5 text-sm">
          <p class="meta-label">Host ödemesi</p><p class="meta-value">{{ formatWei(reservation.settlement.hostAmountWei) }}</p>
          <p class="meta-label mt-4">İade</p><p class="meta-value">{{ formatWei(reservation.settlement.refundWei) }}</p>
        </div>
      </aside>
    </div>
  </PageShell>
</template>
