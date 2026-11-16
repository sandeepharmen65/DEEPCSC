<script setup lang="ts">
import Todos from './components/Todos.vue'
import { Analytics } from '@vercel/analytics/vue'
</script>

<template>
  <Analytics />
  <main>
    <Todos />
  </main>
</template>

