<script setup lang="ts">
import { ref } from 'vue'
import HeroSection from '../components/home/HeroSection.vue'
import NetworkTicker from '../components/home/NetworkTicker.vue'
import RoleSelect from '../components/home/RoleSelect.vue'
import type { Role } from '../components/home/RoleSelect.vue'
import HowItWorks from '../components/home/HowItWorks.vue'
import ValueProps from '../components/home/ValueProps.vue'
import ProofOfCharge from '../components/home/ProofOfCharge.vue'
import CtaSection from '../components/home/CtaSection.vue'

const activeRole = ref<Role>('driver')
</script>

<template>
  <main>
    <HeroSection />
    <NetworkTicker />
    <RoleSelect v-model="activeRole" />
    <HowItWorks :active-role="activeRole" />
    <ValueProps />
    <ProofOfCharge />
    <CtaSection />
  </main>
</template>
