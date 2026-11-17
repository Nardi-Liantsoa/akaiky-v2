<script setup lang="ts">
import { RouterView } from 'vue-router'
import TabBar from '../../components/parent/TabBar.vue'
</script>

<template>
  <main class="shell">
    <RouterView />
  </main>
  <TabBar />
</template>

<style scoped>
.shell {
  /* Zones sûres en natif comme sur le web (viewport-fit=cover) : --safe-* vaut 0 sans encoche. */
  padding: 24px calc(var(--gutter) + var(--safe-right)) calc(var(--tab-height) + var(--safe-bottom) + 24px)
    calc(var(--gutter) + var(--safe-left));
  max-width: 720px;
  margin: 0 auto;
}
</style>
