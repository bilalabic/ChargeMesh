<script setup lang="ts">
import type { CreateNodeRequest } from "@chargemesh/shared";
import { reactive, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import { getApiClient } from "../lib/api";
import { errorMessage } from "../lib/presentation";

const api = getApiClient();
const router = useRouter();
const saving = ref(false);
const error = ref("");
const form = reactive<CreateNodeRequest>({
  name: "Moda Ofis Otoparkı",
  areaLabel: "Kadıköy, İstanbul",
  addressLine: "Caferağa Mah. Moda Cad. No:1, Kadıköy/İstanbul",
  lat: 40.9869,
  lng: 29.0267,
  connectorType: "TYPE2",
  maxPowerKw: 7.4,
  accessType: "GATED_PARKING",
  accessInstructions: "B2 katı, 14 numaralı park yeri. Bariyerde ChargeMesh rezervasyonunu söyleyin.",
  ocppChargePointId: `CM-${Date.now().toString().slice(-6)}`,
  ocppConnectorId: 1,
});

async function submit() {
  saving.value = true;
  error.value = "";
  try {
    const node = await api.createNode({ ...form });
    await router.push(`/host/nodes/${node.id}`);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <PageShell eyebrow="Host · Yeni node" title="Şarj noktasını tanımlayın" description="Özel konum ve erişim bilgileri yalnızca onaylanmış rezervasyondaki Sürücü'ye açılır.">
    <template #actions><RouterLink class="button-secondary" to="/host">Panele dön</RouterLink></template>
    <form class="mx-auto max-w-3xl space-y-6" @submit.prevent="submit">
      <NoticeBox v-if="error" kind="error">{{ error }}</NoticeBox>
      <div class="form-grid">
        <label class="field sm:col-span-2"><span>Node adı</span><input v-model="form.name" required minlength="3" /></label>
        <label class="field"><span>Bölge</span><input v-model="form.areaLabel" required /></label>
        <label class="field"><span>Adres</span><input v-model="form.addressLine" required /></label>
        <label class="field"><span>Enlem</span><input v-model.number="form.lat" type="number" step="0.0001" required /></label>
        <label class="field"><span>Boylam</span><input v-model.number="form.lng" type="number" step="0.0001" required /></label>
        <label class="field"><span>Bağlantı</span><select v-model="form.connectorType"><option value="TYPE2">Type 2</option><option value="TYPE1">Type 1</option></select></label>
        <label class="field"><span>Güç (kW)</span><input v-model.number="form.maxPowerKw" type="number" min="1" max="22" step="0.1" required /></label>
        <label class="field"><span>Erişim türü</span><select v-model="form.accessType"><option value="OPEN_PARKING">Açık otopark</option><option value="GATED_PARKING">Kapalı otopark</option><option value="BUILDING_GARAGE">Bina garajı</option></select></label>
        <label class="field"><span>Charge point ID</span><input v-model="form.ocppChargePointId" required /></label>
        <label class="field"><span>Konnektör</span><input v-model.number="form.ocppConnectorId" type="number" min="1" required /></label>
        <label class="field sm:col-span-2"><span>Erişim talimatı</span><textarea v-model="form.accessInstructions" rows="4"></textarea></label>
      </div>
      <button class="button-primary w-full justify-center" type="submit" :disabled="saving">{{ saving ? "Kaydediliyor…" : "Node'u oluştur" }}</button>
    </form>
  </PageShell>
</template>
