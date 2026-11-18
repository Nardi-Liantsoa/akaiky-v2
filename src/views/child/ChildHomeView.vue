<script setup lang="ts">
import { useT } from '../../composables/useT'

const t = useT()
</script>

<template>
  <!-- Écran d'attente de l'app enfant : l'accueil (contacts, SOS) arrive avec NAR-142,
       une fois le téléphone appairé (NAR-138). -->
  <main class="child">
    <h1>Akaiky</h1>
    <p class="waiting">{{ t.child.waiting }}</p>
    <p class="hint">{{ t.child.hint }}</p>
  </main>
</template>

<style scoped>
.child {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 100vh;
  padding: calc(var(--safe-top) + 24px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
  text-align: center;
}
h1 {
  margin: 0 0 8px;
  font-size: 3rem;
  font-weight: 900;
}
.waiting {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
}
.hint {
  margin: 0;
  color: var(--text-soft);
}
</style>
