<script setup lang="ts">
withDefaults(
  defineProps<{
    kind?: "info" | "error" | "success";
  }>(),
  { kind: "info" },
);
</script>

<template>
  <div
    class="rounded-xl border px-4 py-3 text-sm"
    :class="{
      'border-sky-400/30 bg-sky-400/10 text-sky-100': kind === 'info',
      'border-red-400/30 bg-red-400/10 text-red-100': kind === 'error',
      'border-volt-400/30 bg-volt-400/10 text-volt-300': kind === 'success',
    }"
  >
    <slot />
  </div>
</template>
