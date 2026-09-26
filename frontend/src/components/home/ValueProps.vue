<script setup lang="ts">
const items: { title: string; description: string; icon: string; span: string; big?: boolean }[] = [
  {
    title: 'Zaten gideceğin yerde',
    description:
      'Cihazı sana taşımıyoruz — ofis, otel ya da apartmanda zaten duracağın süre, rezerve edilebilir kapasiteye dönüşüyor.',
    icon: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    span: 'sm:col-span-2 lg:col-span-2 lg:row-span-2',
    big: true,
  },
  {
    title: 'Deterministik eşleştirme',
    description:
      'Bağlantı uyumu, erişim, mesafe ve zaman aralığına göre net bir sıralama; pazarlık ya da belirsiz bekleme yok.',
    icon: 'M4 6h16M4 6l4-3M4 6l4 3M20 18H4M20 18l-4-3M20 18l-4 3',
    span: 'sm:col-span-2 lg:col-span-2',
  },
  {
    title: 'Net gizlilik sınırı',
    description:
      'Açık adres, araç/kişi bilgisi ve ham sayaç akışı zincire yazılmaz. Erişim bilgisi yalnızca onaylanan rezervasyona gösterilir.',
    icon: 'M12 2l7 3v6c0 4.9-3 9.3-7 11-4-1.7-7-6.1-7-11V5l7-3z',
    span: 'lg:col-span-1',
  },
  {
    title: 'Ölçüme dayalı hesaplaşma',
    description:
      'Talep edilen ve aktarılan enerji karşılaştırılır; sonuç Proof of Charge özeti olarak kaydedilir, ödeme buna göre sonuçlanır.',
    icon: 'M9 12.5l2 2 4-4.5M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z',
    span: 'lg:col-span-1',
  },
]
</script>

<template>
  <section class="border-t border-ink-800 bg-ink-900/30">
    <div class="mx-auto max-w-7xl px-6 py-24 lg:px-8">
      <div class="max-w-2xl">
        <p class="font-mono text-sm text-ink-400">Neden ChargeMesh</p>
        <h2 class="mt-3 text-3xl font-semibold text-ink-50 sm:text-4xl">
          Kapasite <span class="accent-serif text-volt-400">gerçek</span>, kurallar net.
        </h2>
      </div>

      <div class="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
        <div
          v-for="item in items"
          :key="item.title"
          class="relative overflow-hidden rounded-2xl border border-ink-800 bg-ink-950 p-8 transition-colors hover:border-ink-600"
          :class="item.span"
        >
          <span
            class="ghost-numeral pointer-events-none absolute -right-3 -bottom-8 text-[8rem] leading-none"
            :class="item.big ? 'lg:text-[11rem]' : ''"
            aria-hidden="true"
          >
            {{ String(items.indexOf(item) + 1).padStart(2, '0') }}
          </span>

          <span
            class="relative flex h-10 w-10 items-center justify-center rounded-lg border border-ink-700 text-volt-400"
            :class="item.big ? 'h-12 w-12' : ''"
          >
            <svg viewBox="0 0 24 24" fill="none" class="h-5 w-5" :class="item.big ? 'h-6 w-6' : ''" aria-hidden="true">
              <path :d="item.icon" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <h3 class="relative mt-5 font-semibold text-ink-50" :class="item.big ? 'text-2xl' : 'text-lg'">
            {{ item.title }}
          </h3>
          <p class="relative mt-2 max-w-sm text-ink-300" :class="item.big ? 'text-base' : 'text-sm'">
            {{ item.description }}
          </p>

          <ul v-if="item.big" class="relative mt-8 flex flex-wrap gap-2">
            <li
              v-for="place in ['Ofis', 'Otel', 'Apartman', 'Özel otopark']"
              :key="place"
              class="rounded-full border border-ink-700 px-3 py-1 text-xs text-ink-300"
            >
              {{ place }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>
