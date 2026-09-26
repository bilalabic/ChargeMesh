<script setup lang="ts">
import { RouterLink } from 'vue-router'

export type Role = 'driver' | 'host'

const activeRole = defineModel<Role>({ required: true })

const roles: {
  id: Role
  title: string
  description: string
  bullets: string[]
  accent: 'volt' | 'ember'
  to: string
  linkLabel: string
}[] = [
  {
    id: 'driver',
    title: 'Sürücü',
    description:
      'Gideceğin yeri, varış-ayrılış saatini ve ihtiyacın olan enerjiyi gir; sistem uygun noktayı bulup rezerve etsin.',
    bullets: ['Konum ve zaman aralığı gir', 'Uygun slotlar arasından seç', 'QR ile oturumu başlat'],
    accent: 'volt',
    to: '/driver',
    linkLabel: 'Sürücü ekranına git',
  },
  {
    id: 'host',
    title: 'Host',
    description:
      'Ofis, otel, apartman veya özel otoparkındaki AC şarj cihazını ve uygun saatlerini yayınla, rezervasyon al.',
    bullets: ['Charging Node ekle', 'Uygun saatleri Energy Slot olarak yayınla', 'Rezervasyonu onayla, hizmeti sun'],
    accent: 'ember',
    to: '/host',
    linkLabel: 'Host paneline git',
  },
]
</script>

<template>
  <section id="roller" class="mx-auto max-w-7xl scroll-mt-24 px-6 py-24 lg:px-8">
    <div class="max-w-2xl">
      <p class="font-mono text-sm text-ink-400">İki rol, tek ağ</p>
      <h2 class="mt-3 text-3xl font-semibold text-ink-50 sm:text-4xl">
        Hangi <span class="accent-serif text-volt-400">taraftasın?</span>
      </h2>
      <p class="mt-4 text-lg text-ink-300">
        ChargeMesh iki basit rol üzerine kurulu. Birini seç, aşağıdaki akış o role göre vurgulansın.
      </p>
    </div>

    <div class="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
      <div
        v-for="role in roles"
        :key="role.id"
        class="group relative rounded-2xl border p-8 text-left transition-all duration-200"
        :class="[
          activeRole === role.id
            ? role.accent === 'volt'
              ? 'border-volt-400/70 bg-volt-400/[0.06]'
              : 'border-ember-400/70 bg-ember-400/[0.06]'
            : 'border-ink-700 bg-ink-900/40 hover:border-ink-500',
        ]"
      >
        <!-- The whole card selects the role; the arrow link on top navigates to that role's screen. -->
        <button
          type="button"
          class="absolute inset-0 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2"
          :class="role.accent === 'volt' ? 'focus-visible:outline-volt-400' : 'focus-visible:outline-ember-400'"
          :aria-pressed="activeRole === role.id"
          :aria-label="`${role.title} rolünü seç`"
          @click="activeRole = role.id"
        />

        <div class="pointer-events-none relative flex items-center justify-between">
          <h3
            class="text-xl font-semibold"
            :class="activeRole === role.id ? (role.accent === 'volt' ? 'text-volt-300' : 'text-ember-300') : 'text-ink-50'"
          >
            {{ role.title }}
          </h3>
          <RouterLink
            :to="role.to"
            class="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            :class="[
              activeRole === role.id
                ? role.accent === 'volt'
                  ? 'border-volt-400 text-volt-300'
                  : 'border-ember-400 text-ember-300'
                : 'border-ink-600 text-ink-400 group-hover:text-ink-200',
              role.accent === 'volt'
                ? 'hover:border-volt-400 hover:bg-volt-400 hover:text-ink-950 focus-visible:outline-volt-400'
                : 'hover:border-ember-400 hover:bg-ember-400 hover:text-ink-950 focus-visible:outline-ember-400',
            ]"
            :aria-label="role.linkLabel"
            :title="role.linkLabel"
          >
            <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4" aria-hidden="true">
              <path
                d="M7 17L17 7M17 7H9M17 7V15"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </RouterLink>
        </div>

        <p class="pointer-events-none relative mt-3 text-ink-300">{{ role.description }}</p>

        <ul class="pointer-events-none relative mt-6 space-y-2.5 text-sm text-ink-200">
          <li v-for="bullet in role.bullets" :key="bullet" class="flex items-start gap-2.5">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              class="mt-0.5 h-4 w-4 flex-shrink-0"
              :class="role.accent === 'volt' ? 'text-volt-400' : 'text-ember-400'"
              aria-hidden="true"
            >
              <path
                d="M4 10.5L8 14.5L16 6"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ bullet }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
