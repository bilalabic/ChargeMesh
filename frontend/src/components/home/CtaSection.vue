<script setup lang="ts">
import MagneticButton from '../layout/MagneticButton.vue'
</script>

<template>
  <section class="border-t border-ink-800">
    <div class="grid-field relative mx-auto max-w-7xl overflow-hidden px-6 py-24 text-center lg:px-8">
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950" />
      <div class="relative">
        <h2 class="text-balance mx-auto max-w-2xl text-3xl font-semibold text-ink-50 sm:text-4xl">
          Uçtan uca <span class="accent-serif text-volt-400">senaryoyu</span> görmeye hazır mısın?
        </h2>
        <p class="mx-auto mt-4 max-w-xl text-lg text-ink-300">
          Bir host, bir driver, tek bir başarılı rezervasyon: cihazdan Proof of Charge'a kadar.
        </p>
        <div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <MagneticButton
            href="/driver"
            class="cursor-pointer rounded-lg bg-volt-400 px-6 py-3.5 font-medium text-ink-950 transition-colors hover:bg-volt-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt-400"
          >
            Sürücü olarak başla
          </MagneticButton>
          <MagneticButton
            href="/host"
            class="cursor-pointer rounded-lg border border-ink-600 px-6 py-3.5 font-medium text-ink-50 transition-colors hover:border-ember-400 hover:text-ember-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
          >
            Host olarak başla
          </MagneticButton>
        </div>
      </div>
    </div>
  </section>
</template>
