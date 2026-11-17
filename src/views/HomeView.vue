<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { auth } from '../store/auth'
import { useT } from '../composables/useT'

const t = useT()
</script>

<template>
  <main class="page">
    <h1>{{ t.home.title }}</h1>
    <p class="lead">{{ t.home.lead }}</p>
    <RouterLink v-if="auth.user" class="btn" :to="{ name: 'espace' }">{{ t.home.open }}</RouterLink>
    <RouterLink v-else class="btn" :to="{ name: 'connexion', query: { mode: 'register' } }">{{ t.home.start }}</RouterLink>
  </main>
</template>

<style scoped>
.lead {
  color: var(--text-soft);
  max-width: 60ch;
  margin: 0 0 24px;
}
.btn:hover {
  text-decoration: none;
}
</style>
