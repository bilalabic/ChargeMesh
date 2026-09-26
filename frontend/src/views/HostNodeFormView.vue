<script setup lang="ts">
import type { AccessType, ConnectorType, CreateNodeRequest } from "@chargemesh/shared";
import { computed, reactive, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import NoticeBox from "../components/ui/NoticeBox.vue";
import PageShell from "../components/ui/PageShell.vue";
import { getApiClient } from "../lib/api";
import {
  DEFAULT_LOCATION,
  LOCATION_OPTIONS,
  addressLineFor,
  areaLabelFor,
  districtsFor,
  neighborhoodsFor,
  resolveLocation,
} from "../lib/locations";
import { errorMessage } from "../lib/presentation";

const api = getApiClient();
const router = useRouter();
const saving = ref(false);
const error = ref("");
const location = reactive({ ...DEFAULT_LOCATION });
const form = reactive({
  name: "Moda Ofis Otoparkı",
  addressDetail: "Moda Cad. No:1",
  connectorType: "TYPE2" as ConnectorType,
  maxPowerKw: 7.4,
  accessType: "GATED_PARKING" as AccessType,
  accessInstructions: "B2 katı, 14 numaralı park yeri. Bariyerde ChargeMesh rezervasyonunu söyleyin.",
  ocppChargePointId: `CM-${Date.now().toString().slice(-6)}`,
  ocppConnectorId: 1,
});

const districtOptions = computed(() => districtsFor(location.city));
const neighborhoodOptions = computed(() => neighborhoodsFor(location.city, location.district));

function selectCity() {
  location.district = districtOptions.value[0]?.name ?? "";
  selectDistrict();
}

function selectDistrict() {
  location.neighborhood = neighborhoodOptions.value[0]?.name ?? "";
}

async function submit() {
  saving.value = true;
  error.value = "";
  try {
    const coordinates = resolveLocation(location);
    if (!coordinates) throw new Error("Lütfen geçerli bir şehir, ilçe ve mahalle seçin.");
    const payload: CreateNodeRequest = {
      name: form.name,
      areaLabel: areaLabelFor(location),
      addressLine: addressLineFor(location, form.addressDetail),
      lat: coordinates.lat,
      lng: coordinates.lng,
      connectorType: form.connectorType,
      maxPowerKw: form.maxPowerKw,
      accessType: form.accessType,
      accessInstructions: form.accessInstructions,
      ocppChargePointId: form.ocppChargePointId,
      ocppConnectorId: form.ocppConnectorId,
    };
    const node = await api.createNode(payload);
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
        <label class="field">
          <span>Şehir</span>
          <select v-model="location.city" required @change="selectCity">
            <option v-for="city in LOCATION_OPTIONS" :key="city.name" :value="city.name">{{ city.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>İlçe</span>
          <select v-model="location.district" required @change="selectDistrict">
            <option v-for="district in districtOptions" :key="district.name" :value="district.name">{{ district.name }}</option>
          </select>
        </label>
        <label class="field sm:col-span-2">
          <span>Mahalle</span>
          <select v-model="location.neighborhood" required>
            <option v-for="neighborhood in neighborhoodOptions" :key="neighborhood.name" :value="neighborhood.name">{{ neighborhood.name }}</option>
          </select>
        </label>
        <label class="field sm:col-span-2"><span>Sokak / bina</span><input v-model="form.addressDetail" required minlength="3" /></label>
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
