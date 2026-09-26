<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, ref } from 'vue'
import gsap from 'gsap'
import MagneticButton from '../layout/MagneticButton.vue'
import { usePrefersReducedMotion } from '../../composables/usePrefersReducedMotion'

const MeshScene = defineAsyncComponent(() => import('./MeshScene.vue'))

const chips = ['AC Level 2 uyumlu', 'OCPP simülasyonu', 'Monad testnet üzerinde rezervasyon']

const headlineWords = [
  { text: 'Boşta' },
  { text: 'duran' },
  { text: 'şarj' },
  { text: 'cihazı' },
  { text: 'yok,' },
  { text: 'rezerve', accent: true },
  { text: 'edilmemiş', accent: true },
  { text: 'kapasite', accent: true },
  { text: 'var.' },
]

const headlineRef = ref<HTMLElement | null>(null)
const prefersReducedMotion = usePrefersReducedMotion()

onMounted(async () => {
  if (prefersReducedMotion.value || !headlineRef.value) return
  await nextTick()
  const words = headlineRef.value.querySelectorAll('.word-inner')
  gsap.from(words, {
    yPercent: 115,
    duration: 0.85,
    stagger: 0.045,
    delay: 0.15,
    ease: 'power4.out',
  })
})
</script>

<template>
  <section class="grid-field relative overflow-hidden border-b border-ink-700/60 pt-28 pb-20 sm:pt-36">
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-ink-950" />

    <div class="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8">
      <div>
        <div class="inline-flex items-center gap-2 rounded-full border border-ink-600 bg-ink-900/70 px-3.5 py-1.5 text-xs text-ink-300">
          <span class="relative flex h-2 w-2">
            <span class="animate-pulse-soft absolute inline-flex h-full w-full rounded-full bg-volt-400" />
          </span>
          Monad testnet · hackathon demo
        </div>

        <h1
          ref="headlineRef"
          class="text-balance mt-6 max-w-xl text-[2.75rem] leading-[1.05] font-semibold text-ink-50 sm:text-6xl"
        >
          <span v-for="(word, i) in headlineWords" :key="i" class="mr-3 inline-block overflow-hidden pb-[0.15em] align-bottom">
            <span
              class="word-inner inline-block"
              :class="word.accent ? 'accent-serif text-volt-400' : ''"
            >
              {{ word.text }}
            </span>
          </span>
        </h1>

        <p class="text-balance mt-6 max-w-lg text-lg leading-relaxed text-ink-300">
          ChargeMesh; ofis, otel, apartman ve özel otoparklardaki atıl AC şarj cihazlarını,
          sürücünün varış saatine ve enerji ihtiyacına göre rezerve edilebilir kapasiteye dönüştürür.
        </p>

        <div class="mt-9 flex flex-col gap-3 sm:flex-row">
          <MagneticButton
            href="#roller"
            class="cursor-pointer rounded-lg bg-volt-400 px-6 py-3.5 text-center font-medium text-ink-950 transition-colors hover:bg-volt-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-volt-400"
          >
            Sürücü olarak rezervasyon yap
          </MagneticButton>
          <MagneticButton
            href="#roller"
            class="cursor-pointer rounded-lg border border-ink-600 bg-ink-900/60 px-6 py-3.5 text-center font-medium text-ink-50 transition-colors hover:border-ember-400 hover:text-ember-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
          >
            Host olarak cihaz ekle
          </MagneticButton>
        </div>

        <ul class="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-400">
          <li v-for="chip in chips" :key="chip" class="flex items-center gap-2">
            <span class="h-1 w-1 rounded-full bg-ink-500" aria-hidden="true" />
            {{ chip }}
          </li>
        </ul>
      </div>

      <div class="relative mx-auto aspect-square w-full max-w-md lg:max-w-none">
        <div class="animate-drift absolute inset-8 rounded-full bg-volt-400/10 blur-3xl" aria-hidden="true" />
        <Suspense>
          <MeshScene />
          <template #fallback>
            <div class="h-full w-full rounded-3xl border border-ink-700/50 bg-ink-900/30" />
          </template>
        </Suspense>
      </div>
    </div>
  </section>
</template>
