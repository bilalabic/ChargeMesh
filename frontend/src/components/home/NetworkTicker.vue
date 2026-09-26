<script setup lang="ts">
const events: { text: string; tone: 'volt' | 'ember' | 'neutral' }[] = [
  { text: 'Energy Slot yayınlandı · Ofis · 18:00–22:00', tone: 'ember' },
  { text: 'Charge Intent oluşturuldu · 7.4 kWh', tone: 'volt' },
  { text: 'Uygun slot eşleşti · mesafe 180 m', tone: 'neutral' },
  { text: 'Rezervasyon Monad testnet’te kaydedildi', tone: 'volt' },
  { text: 'Energy Slot yayınlandı · Otel otoparkı · 07:00–11:00', tone: 'ember' },
  { text: 'QR ile oturum başladı', tone: 'volt' },
  { text: 'Proof of Charge özeti oluşturuldu', tone: 'neutral' },
]

const doubled = [...events, ...events]

const toneClass: Record<string, string> = {
  volt: 'bg-volt-400',
  ember: 'bg-ember-400',
  neutral: 'bg-ink-400',
}
</script>

<template>
  <section class="overflow-hidden border-y border-ink-800 bg-ink-900/40 py-4">
    <div class="mx-auto flex max-w-7xl items-center gap-5 px-6 lg:px-8">
      <span class="shrink-0 font-mono text-[11px] tracking-wide text-ink-500 uppercase">Örnek ağ akışı</span>

      <div class="relative flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div class="marquee-track flex w-max items-center gap-10 whitespace-nowrap font-mono text-xs text-ink-400">
          <span v-for="(event, i) in doubled" :key="i" class="flex items-center gap-2.5">
            <span class="h-1.5 w-1.5 rounded-full" :class="toneClass[event.tone]" aria-hidden="true" />
            {{ event.text }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
