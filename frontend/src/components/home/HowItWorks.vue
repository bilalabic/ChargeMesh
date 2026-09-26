<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { usePrefersReducedMotion } from '../../composables/usePrefersReducedMotion'
import type { Role } from './RoleSelect.vue'

gsap.registerPlugin(ScrollTrigger)

defineProps<{ activeRole: Role }>()

type StepRole = Role | 'system'

const steps: { role: StepRole; title: string; description: string; icon: string }[] = [
  {
    role: 'host',
    title: 'Cihaz ve slot yayınlanır',
    description:
      'Host bir Charging Node ekler; uygun zaman aralığı ve kapasitesinden bir Energy Slot yayınlar.',
    icon: 'M13 3L4 14h6l-1 7 9-11h-6l1-7z',
  },
  {
    role: 'driver',
    title: 'Charge Intent oluşturulur',
    description: 'Driver hedef konumu, varış-ayrılış saatini ve istenen kWh miktarını girer.',
    icon: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  },
  {
    role: 'system',
    title: 'Uygun slot eşleştirilir',
    description:
      'Sistem bağlantı uyumu, erişim, mesafe ve zaman aralığına göre uygun slotları sıralar; driver seçimini onaylar.',
    icon: 'M4 6h16M4 6l4-3M4 6l4 3M20 18H4M20 18l-4-3M20 18l-4 3',
  },
  {
    role: 'driver',
    title: 'Rezervasyon kaydedilir, oturum QR ile başlar',
    description:
      'Rezervasyon taahhüdü Monad testnet üzerinde kaydedilir. Driver noktaya vardığında QR ile oturumu başlatır.',
    icon: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h6m-3-3v6',
  },
  {
    role: 'system',
    title: 'Proof of Charge ile sonuçlanır',
    description:
      'OCPP simülasyonu sayaç verisini iletir; talep edilen ve aktarılan enerji karşılaştırılır, test ödemesi sonuçlandırılır.',
    icon: 'M9 12.5l2 2 4-4.5M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6l7-3z',
  },
]

const prefersReducedMotion = usePrefersReducedMotion()
const sectionRef = ref<HTMLElement | null>(null)
const trackFillRef = ref<HTMLElement | null>(null)
const stepRefs = ref<HTMLElement[]>([])
const triggers: ScrollTrigger[] = []

function setStepRef(el: Element | null, index: number) {
  if (el instanceof HTMLElement) stepRefs.value[index] = el
}

onMounted(() => {
  if (prefersReducedMotion.value || !sectionRef.value) return

  if (trackFillRef.value) {
    triggers.push(
      ScrollTrigger.create({
        trigger: sectionRef.value,
        start: 'top 65%',
        end: 'bottom 55%',
        scrub: 0.6,
        onUpdate: (self) => {
          if (trackFillRef.value) trackFillRef.value.style.transform = `scaleY(${self.progress})`
        },
      }),
    )
  }

  stepRefs.value.forEach((stepEl) => {
    gsap.set(stepEl, { opacity: 0, y: 28 })
    triggers.push(
      ScrollTrigger.create({
        trigger: stepEl,
        start: 'top 82%',
        onEnter: () => gsap.to(stepEl, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }),
        toggleClass: { targets: stepEl, className: 'is-active' },
      }),
    )
  })
})

onBeforeUnmount(() => {
  triggers.forEach((trigger) => trigger.kill())
})
</script>

<template>
  <section id="nasil-calisir" class="mx-auto max-w-5xl scroll-mt-24 px-6 py-24 lg:px-8">
    <div class="max-w-2xl">
      <p class="font-mono text-sm text-ink-400">Uçtan uca akış</p>
      <h2 class="mt-3 text-3xl font-semibold text-ink-50 sm:text-4xl">
        Nasıl <span class="accent-serif text-volt-400">çalışır?</span>
      </h2>
      <p class="mt-4 text-lg text-ink-300">
        Beş adımda: cihaz yayınından Monad testnet üzerinde kaydedilen rezervasyona,
        oradan Proof of Charge özetine.
      </p>
    </div>

    <div ref="sectionRef" class="relative mt-16">
      <div class="absolute top-0 bottom-0 left-[15px] w-px bg-ink-700 sm:left-[19px]">
        <div
          ref="trackFillRef"
          class="h-full w-full origin-top scale-y-0 bg-gradient-to-b from-volt-400 to-ember-400"
        />
      </div>

      <ol class="space-y-14">
        <li
          v-for="(step, index) in steps"
          :key="step.title"
          :ref="(el) => setStepRef(el as Element | null, index)"
          class="step-item relative pl-12 sm:pl-16"
          :class="[
            step.role !== 'system' && step.role !== activeRole ? 'opacity-60' : 'opacity-100',
          ]"
        >
          <span class="ghost-numeral pointer-events-none absolute -top-8 right-0 hidden select-none text-[7rem] sm:block lg:text-[8.5rem]" aria-hidden="true">
            {{ String(index + 1).padStart(2, '0') }}
          </span>

          <span
            class="absolute top-0 left-0 flex h-8 w-8 items-center justify-center rounded-full border-2 bg-ink-950 transition-colors duration-300 sm:h-10 sm:w-10"
            :class="
              step.role === 'host'
                ? 'border-ember-400 text-ember-300'
                : step.role === 'driver'
                  ? 'border-volt-400 text-volt-300'
                  : 'border-ink-400 text-ink-200'
            "
          >
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true">
              <path :d="step.icon" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>

          <p class="font-mono text-xs tracking-wide text-ink-400 uppercase">
            Adım {{ String(index + 1).padStart(2, '0') }}
            <span v-if="step.role !== 'system'">· {{ step.role === 'host' ? 'Host' : 'Driver' }}</span>
          </p>
          <h3 class="mt-1.5 text-xl font-semibold text-ink-50">{{ step.title }}</h3>
          <p class="mt-2 max-w-xl text-ink-300">{{ step.description }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.step-item {
  transition: opacity 0.3s ease;
}
</style>
