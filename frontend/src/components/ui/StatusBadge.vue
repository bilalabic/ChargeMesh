<script setup lang="ts">
import { computed } from "vue";
import { statusLabel, statusTone } from "../../lib/presentation";

const props = defineProps<{ status: string }>();
const tone = computed(() => statusTone(props.status));
</script>

<template>
  <span
    class="inline-flex rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide"
    :class="{
      'border-volt-400/30 bg-volt-400/10 text-volt-300': tone === 'success',
      'border-amber-400/30 bg-amber-400/10 text-amber-200': tone === 'warning',
      'border-red-400/30 bg-red-400/10 text-red-200': tone === 'danger',
      'border-ink-600 bg-ink-800 text-ink-300': tone === 'neutral',
    }"
  >
    {{ statusLabel(status) }}
  </span>
</template>
