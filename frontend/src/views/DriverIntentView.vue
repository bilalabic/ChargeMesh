<script setup lang="ts">
import type { AccessType, ConnectorType } from "@chargemesh/shared";
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import { getApiClient } from "../lib/api";
import { errorMessage, toLocalInput } from "../lib/presentation";

const api = getApiClient();
const router = useRouter();
const saving = ref(false);
const error = ref("");
const now = new Date(Date.now() + 5 * 60_000);
const form = reactive({
  lat: 40.9875,
  lng: 29.03,
  radiusKm: 3,
  arriveAt: toLocalInput(now),
  departAt: toLocalInput(new Date(now.getTime() + 4 * 3_600_000)),
  requestedKwh: 20,
  connectorType: "TYPE2" as ConnectorType,
  acceptedAccessTypes: ["OPEN_PARKING", "GATED_PARKING", "BUILDING_GARAGE"] as AccessType[],
});

const accessOptions: { value: AccessType; label: string }[] = [
  { value: "OPEN_PARKING", label: "Açık otopark" },
  { value: "GATED_PARKING", label: "Kapalı otopark" },
  { value: "BUILDING_GARAGE", label: "Bina garajı" },
];

async function submit() {
  saving.value = true;
  error.value = "";
  try {
    const intent = await api.createIntent({
      lat: form.lat,
      lng: form.lng,
      radiusKm: form.radiusKm,
      arriveAt: new Date(form.arriveAt).toISOString(),
      departAt: new Date(form.departAt).toISOString(),
      requestedWh: Math.round(form.requestedKwh * 1000),
      connectorType: form.connectorType,
      acceptedAccessTypes: [...form.acceptedAccessTypes],
    });
    await router.push(`/driver/intents/${intent.id}`);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageShell
    eyebrow="Sürücü · Enerji talebi"
    title="Gideceğiniz yerde şarj bulun"
    description="Konum, zaman ve enerji ihtiyacınızı girin. ChargeMesh uygun slotları mesafe, kapsama ve fiyata göre sıralar."
  >
    <form class="mx-auto max-w-3xl space-y-6" @submit.prevent="submit">
      <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
      <div class="rounded-2xl border border-ink-700 bg-ink-900/60 p-6 sm:p-8">
        <div class="form-grid">
          <label class="field"><span>Hedef enlem</span><input v-model.number="form.lat" type="number" step="0.0001" required /></label>
          <label class="field"><span>Hedef boylam</span><input v-model.number="form.lng" type="number" step="0.0001" required /></label>
          <label class="field"><span>Varış</span><input v-model="form.arriveAt" type="datetime-local" required /></label>
          <label class="field"><span>Ayrılış</span><input v-model="form.departAt" type="datetime-local" required /></label>
          <label class="field"><span>Enerji ihtiyacı (kWh)</span><input v-model.number="form.requestedKwh" type="number" min="1" max="100" step="0.1" required /></label>
          <label class="field"><span>Arama yarıçapı (km)</span><input v-model.number="form.radiusKm" type="number" min="0.5" max="25" step="0.5" required /></label>
          <label class="field sm:col-span-2"><span>Bağlantı</span><select v-model="form.connectorType"><option value="TYPE2">Type 2</option><option value="TYPE1">Type 1</option></select></label>
        </div>
        <fieldset class="mt-6">
          <legend class="text-sm font-medium text-ink-200">Kabul edilen erişim türleri</legend>
          <div class="mt-3 flex flex-wrap gap-3">
            <label v-for="option in accessOptions" :key="option.value" class="check-pill">
              <input v-model="form.acceptedAccessTypes" type="checkbox" :value="option.value" />
              {{ option.label }}
            </label>
          </div>
        </fieldset>
      </div>
      <button class="button-primary w-full justify-center" type="submit" :disabled="saving">{{ saving ? "Eşleşmeler aranıyor…" : "Uygun noktaları bul" }}</button>
    </form>
  </PageShell>
</template>
