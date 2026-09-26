<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import { getApiClient } from "../lib/api";
import { errorMessage } from "../lib/presentation";

const api = getApiClient();
const route = useRoute();
const router = useRouter();
const starting = ref(false);
const error = ref("");
const chargePointId = computed(() => String(route.query.cp ?? ""));
const connectorId = computed(() => Number(route.query.c ?? 1));

async function start() {
  if (!chargePointId.value) {
    error.value = "QR bağlantısında charge point kimliği eksik.";
    return;
  }
  starting.value = true;
  error.value = "";
  try {
    const session = await api.startSession({
      chargePointId: chargePointId.value,
      connectorId: connectorId.value,
    });
    await router.replace(`/driver/reservations/${session.reservationId}`);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    starting.value = false;
  }
}

onMounted(start);
</script>

<template>
  <PageShell eyebrow="QR başlangıcı" title="Şarj oturumu hazırlanıyor" :description="`${chargePointId || 'Bilinmeyen cihaz'} · Konnektör ${connectorId}`">
    <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
    <div class="mt-6 rounded-2xl border border-ink-700 bg-ink-900/60 p-8 text-center">
      <p class="text-ink-300">{{ starting ? "Uygun onaylı rezervasyon aranıyor ve cihaz başlatılıyor…" : "Oturum başlatılamadı." }}</p>
      <div class="mt-6 flex justify-center gap-3">
        <button v-if="error" class="button-primary" type="button" @click="start">Tekrar dene</button>
        <RouterLink class="button-secondary" to="/driver">Sürücü ekranı</RouterLink>
      </div>
    </div>
  </PageShell>
</template>
