<script setup lang="ts">
import { computed } from 'vue'
import { useT } from '../../composables/useT'
import { accentToken, initial, tintToken } from '../../lib/avatar'
import AppIcon from '../ui/AppIcon.vue'

// Vignette d'un contact autorisé : un appui appelle (maquette allégée, NAR-237). Une seule
// action, dite sous le nom (« Appeler » et son icône) ; l'initiale et la couleur portent le reste.
// wide : un seul contact (planche 04, NAR-238) : avatar à gauche, nom et « Appeler » à droite.
const props = defineProps<{ name: string, color: string, busy?: boolean, wide?: boolean }>()
defineEmits<{ call: [] }>()
const t = useT()
const style = computed(() => ({ background: tintToken(props.color) }))
const badge = computed(() => ({ background: accentToken(props.color) }))
</script>

<template>
  <button class="tile" :class="{ wide }" type="button" :style="style" :disabled="busy" :aria-label="t.child.callContact(name)" @click="$emit('call')">
    <span class="avatar" :style="badge" aria-hidden="true">{{ initial(name) }}</span>
    <span class="text">
      <span class="name">{{ name }}</span>
      <span class="call" aria-hidden="true"><AppIcon name="call" :size="16" />{{ t.child.callAction }}</span>
    </span>
  </button>
</template>

<style scoped>
.text {
  /* Pas de display: contents (Chrome 65) : WebView 64 reste prise en charge (NAR-161). */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.tile.wide {
  flex-direction: row;
  justify-content: flex-start;
  gap: 16px;
  min-height: 0;
  padding: 18px 20px;
}
.wide .text {
  align-items: flex-start;
  gap: 4px;
}
.wide .name {
  font-size: 1.4rem;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 140px;
  padding: 18px 10px 14px;
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
  width: 68px;
  height: 68px;
  border-radius: 50%;
  color: var(--on-color);
  font-size: 1.9rem;
  font-weight: 900;
}
.name {
  font-size: 1.2rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.call {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--call);
  font-size: 0.85rem;
  font-weight: 800;
}
</style>
