<script setup lang="ts">
import BrandMark from './BrandMark.vue'

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-ink-800">
    <div class="mx-auto max-w-7xl px-6 py-14 lg:px-8">
      <div class="flex flex-col justify-between gap-8 sm:flex-row">
        <div class="max-w-sm">
          <div class="flex items-center gap-2.5 font-semibold text-ink-50">
            <BrandMark />
            ChargeMesh
          </div>
          <p class="mt-3 text-sm text-ink-400">
            Atıl şarj cihazlarını, sürücülerin zaten gideceği yerde rezerve edilebilir kapasiteye dönüştürür.
          </p>
        </div>

        <div class="text-sm text-ink-400 sm:text-right">
          <p>Monad testnet üzerinde çalışan şarj rezervasyon ağı.</p>
          <p class="mt-1">Hackathon sürümü gerçek şarj hizmeti sunmaz.</p>
        </div>
      </div>

      <div class="mt-10 flex flex-col gap-3 border-t border-ink-800 pt-6 text-xs text-ink-500 sm:flex-row sm:justify-between">
        <p>© {{ year }} ChargeMesh. Tüm hakları saklıdır.</p>
        <p>v0.1 — Fikir ve kapsam dokümanına göre hazırlanmıştır.</p>
      </div>
    </div>
  </footer>
</template>
