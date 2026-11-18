<script setup lang="ts">
import { computed } from 'vue'
import { useT } from '../../composables/useT'
import { accentToken, initial, tintToken } from '../../lib/avatar'

// Vignette d'un contact autorisé : un appui appelle (maquette écran 1). Tout est
// porté par l'image (initiale, couleur, pastille verte) : l'enfant de 6 ans ne lit pas.
const props = defineProps<{ name: string, color: string, busy?: boolean }>()
defineEmits<{ call: [] }>()
const t = useT()
const style = computed(() => ({ background: tintToken(props.color) }))
const badge = computed(() => ({ background: accentToken(props.color) }))
</script>

<template>
  <button class="tile" type="button" :style="style" :disabled="busy" :aria-label="t.child.callContact(name)" @click="$emit('call')">
    <span class="avatar" :style="badge" aria-hidden="true">{{ initial(name) }}</span>
    <span class="name">{{ name }}</span>
    <span class="dial" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" /></svg>
    </span>
  </button>
</template>

<style scoped>
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 140px;
  padding: 16px 8px;
  border: none;
  border-radius: 24px;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.tile:active {
  transform: scale(0.97);
}
.tile:focus-visible {
  outline: 4px solid var(--ink);
  outline-offset: 2px;
}
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  color: var(--on-color);
  font-size: 2.2rem;
  font-weight: 900;
}
.name {
  font-size: 1.25rem;
  font-weight: 900;
  overflow-wrap: anywhere;
}
.dial {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--call);
  color: var(--on-color);
}
</style>
