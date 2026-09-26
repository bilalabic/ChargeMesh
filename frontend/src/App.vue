<script setup lang="ts">
import { RouterView } from "vue-router";
import AppFooter from "./components/layout/AppFooter.vue";
import AppHeader from "./components/layout/AppHeader.vue";
</script>

<template>
  <div class="min-h-screen bg-ink-950">
    <div class="grain-overlay" aria-hidden="true" />
    <AppHeader />
    <RouterView />
    <AppFooter />
  </div>
</template>
