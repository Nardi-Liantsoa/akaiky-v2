<script setup lang="ts">
import { computed } from 'vue'
import { useT } from '../../composables/useT'
import { accentToken, initial, tintToken } from '../../lib/avatar'
import AppIcon from '../ui/AppIcon.vue'

// Vignette d'un contact autorisé : un appui appelle (maquette allégée, NAR-237). Une seule
// action, dite sous le nom (« Appeler » et son icône) ; l'initiale et la couleur portent le reste.
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
    <span class="call" aria-hidden="true"><AppIcon name="call" :size="16" />{{ t.child.callAction }}</span>
  </button>
</template>

<style scoped>
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
