<script setup lang="ts">
defineProps<{ title: string; text: string }>()
</script>

<template>
  <section class="parent-page">
    <h1>{{ title }}</h1>
    <p class="card empty">{{ text }}</p>
  </section>
</template>

<style scoped>
h1 {
  font-size: 2rem;
  margin: 8px 0 20px;
}
.empty {
  margin: 0;
  color: var(--text-soft);
}
</style>
