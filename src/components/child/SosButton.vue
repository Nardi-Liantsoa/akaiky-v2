<script setup lang="ts">
import { useT } from '../../composables/useT'

// Bouton SOS toujours visible (maquette écran 1). Inerte pour l'instant : l'appui
// maintenu 3 secondes et l'alerte arrivent avec le ticket SOS (NAR-149).
const t = useT()
</script>

<template>
  <button class="sos" type="button" :aria-label="t.child.sosLabel">
    <span class="word">SOS</span>
    <span class="hint">{{ t.child.sosHint }}</span>
  </button>
</template>

<style scoped>
.sos {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 96px;
  border: none;
  border-radius: 999px;
  background: var(--sos);
  color: var(--on-color);
  font: inherit;
}
.word {
  font-size: 2.2rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
}
.hint {
  margin-top: 4px;
  font-size: 0.95rem;
  font-weight: 800;
  opacity: 0.9;
}
</style>
