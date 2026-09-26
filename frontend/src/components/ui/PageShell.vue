<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  description?: string;
}>();
</script>

<template>
  <main class="min-h-[75vh] px-6 pb-24 pt-32 lg:px-8">
    <div class="mx-auto max-w-6xl">
      <div class="mb-10 flex flex-col gap-5 border-b border-ink-800 pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div class="max-w-3xl">
          <p class="font-mono text-xs uppercase tracking-[0.18em] text-volt-400">{{ eyebrow }}</p>
          <h1 class="mt-3 text-3xl font-semibold text-ink-50 sm:text-5xl">{{ title }}</h1>
          <p v-if="description" class="mt-4 max-w-2xl text-base text-ink-300 sm:text-lg">{{ description }}</p>
        </div>
        <div class="flex flex-wrap gap-3">
          <slot name="actions" />
        </div>
      </div>
      <slot />
    </div>
  </main>
</template>
