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
  padding: 24px var(--gutter) calc(var(--tab-height) + 24px);
  max-width: 720px;
  margin: 0 auto;
}
</style>
