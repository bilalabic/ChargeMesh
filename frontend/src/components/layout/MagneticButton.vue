<script setup lang="ts">
import { onMounted, ref } from 'vue'
import gsap from 'gsap'
import { usePrefersReducedMotion } from '../../composables/usePrefersReducedMotion'

withDefaults(
  defineProps<{
    href?: string
    strength?: number
  }>(),
  { href: undefined, strength: 0.35 },
)

const rootEl = ref<HTMLElement | null>(null)
const prefersReducedMotion = usePrefersReducedMotion()
const isFinePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

let quickX: ((value: number) => void) | null = null
let quickY: ((value: number) => void) | null = null

onMounted(() => {
  if (!rootEl.value || prefersReducedMotion.value || !isFinePointer) return
  quickX = gsap.quickTo(rootEl.value, 'x', { duration: 0.5, ease: 'power3' })
  quickY = gsap.quickTo(rootEl.value, 'y', { duration: 0.5, ease: 'power3' })
})

function onMouseMove(event: MouseEvent, strength: number) {
  if (!rootEl.value || !quickX || !quickY) return
  const rect = rootEl.value.getBoundingClientRect()
  const relX = event.clientX - (rect.left + rect.width / 2)
  const relY = event.clientY - (rect.top + rect.height / 2)
  quickX(relX * strength)
  quickY(relY * strength)
}

function onMouseLeave() {
  quickX?.(0)
  quickY?.(0)
}
</script>

<template>
  <a
    v-if="href"
    ref="rootEl"
    :href="href"
    class="inline-block will-change-transform"
    @mousemove="onMouseMove($event, strength)"
    @mouseleave="onMouseLeave"
  >
    <slot />
  </a>
  <button
    v-else
    ref="rootEl"
    type="button"
    class="inline-block will-change-transform"
    @mousemove="onMouseMove($event, strength)"
    @mouseleave="onMouseLeave"
  >
    <slot />
  </button>
</template>
