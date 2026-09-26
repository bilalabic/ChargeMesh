<script setup lang="ts">
const serverItems = [
  'Cihaz ve slot ayrıntıları',
  'Konum ve eşleştirme mantığı',
  'Erişim bilgileri',
  'OCPP mesajları ve sayaç kayıtları',
]

const chainItems = [
  'Rezervasyon taahhüdü',
  'Demo depozitosu / ödeme kilidi',
  'Oturum sonucu',
  'Hesaplaşma ve oturum verisinin özeti (hash)',
]
</script>

<template>
  <section id="proof-of-charge" class="mx-auto max-w-6xl scroll-mt-24 px-6 py-24 lg:px-8">
    <div class="max-w-2xl">
      <p class="font-mono text-sm text-ink-400">Veri sınırı</p>
      <h2 class="mt-3 text-3xl font-semibold text-ink-50 sm:text-4xl">
        Zincire sadece <span class="accent-serif text-volt-400">özet</span> gider.
      </h2>
      <p class="mt-4 text-lg text-ink-300">
        Ham veri uygulama sunucusunda kalır; Monad testnet yalnızca taahhüt, sonuç ve hesaplaşmayı tutar.
      </p>
    </div>

    <div class="mt-14 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
      <div class="rounded-2xl border border-ink-700 bg-ink-900/50 p-8">
        <p class="font-mono text-xs tracking-wide text-ink-400 uppercase">Uygulama sunucusu</p>
        <p class="mt-1 text-sm text-ink-400">Off-chain</p>
        <ul class="mt-6 space-y-3">
          <li v-for="item in serverItems" :key="item" class="flex items-start gap-2.5 text-ink-200">
            <span class="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-ink-400" aria-hidden="true" />
            {{ item }}
          </li>
        </ul>
      </div>

      <div class="flex items-center justify-center py-4 lg:py-0">
        <div class="flex flex-col items-center gap-2 text-ink-500">
          <svg viewBox="0 0 24 24" fill="none" class="h-6 w-6 rotate-90 lg:rotate-0" aria-hidden="true">
            <path
              d="M5 12h14m0 0l-5-5m5 5l-5 5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <p class="font-mono text-[11px] text-ink-500">hash</p>
        </div>
      </div>

      <div class="rounded-2xl border border-volt-400/40 bg-volt-400/[0.04] p-8">
        <p class="font-mono text-xs tracking-wide text-volt-300 uppercase">Monad</p>
        <p class="mt-1 text-sm text-ink-400">On-chain testnet</p>
        <ul class="mt-6 space-y-3">
          <li v-for="item in chainItems" :key="item" class="flex items-start gap-2.5 text-ink-200">
            <span class="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-volt-400" aria-hidden="true" />
            {{ item }}
          </li>
        </ul>
      </div>
    </div>

    <p class="mt-8 max-w-3xl text-sm leading-relaxed text-ink-500">
      Simülatörden gelen ölçüm, gerçek donanımdan bağımsız doğrulanmış enerji teslimi anlamına gelmez.
      Bu demo yalnızca ölçüme dayalı kayıt ve hesaplaşma akışını gösterir.
    </p>
  </section>
</template>
