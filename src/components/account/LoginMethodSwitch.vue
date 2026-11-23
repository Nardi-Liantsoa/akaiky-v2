<script setup lang="ts">
import { useT } from '../../composables/useT'

// Choix de l'identifiant de connexion (NAR-202) : adresse email ou numéro de téléphone.
// Deux boutons à bascule (aria-pressed) dans un groupe nommé ; inactifs pendant un envoi
// (l'écran relit l'identifiant choisi à la réponse).
export type LoginMethod = 'email' | 'phone'

const method = defineModel<LoginMethod>({ required: true })
defineProps<{ disabled?: boolean }>()
const t = useT()
</script>

<template>
  <div class="method" role="group" :aria-label="t.auth.method">
    <button type="button" :disabled="disabled" :aria-pressed="method === 'email'" @click="method = 'email'">{{ t.auth.byEmail }}</button>
    <button type="button" :disabled="disabled" :aria-pressed="method === 'phone'" @click="method = 'phone'">{{ t.auth.byPhone }}</button>
  </div>
</template>

<style scoped>
.method {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1);
  padding: var(--space-1);
  margin-bottom: 16px;
  border-radius: var(--radius-pill);
  background: var(--border);
}
button {
  min-height: var(--tap);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-soft);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
button[aria-pressed='true'] {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--text);
}
button:disabled {
  cursor: default;
}
button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
</style>
