<script setup lang="ts">
import { SpeedInsights } from '@vercel/speed-insights/vue'
import Todos from './components/Todos.vue'
</script>

<template>
  <SpeedInsights />
  <main>
    <Todos />
  </main>
</template>

