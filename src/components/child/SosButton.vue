<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useT } from '../../composables/useT'

// Bouton SOS toujours visible (maquette écran 1). Maintenu 3 secondes, il émet
// `trigger` : l'accueil lance le SOS hors ligne (NAR-151 : SMS, cascade, sirène).
const HOLD_MS = 3000
const emit = defineEmits<{ trigger: [] }>()
const t = useT()
const holding = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function start() {
  if (holding.value) return
  holding.value = true
  timer = setTimeout(() => { holding.value = false; emit('trigger') }, HOLD_MS)
}
function cancel() {
  clearTimeout(timer)
  holding.value = false
}
onBeforeUnmount(cancel)
</script>

<template>
  <button
    class="sos" :class="{ holding }" type="button" :aria-label="t.child.sosLabel"
    @pointerdown.prevent="start" @pointerup="cancel" @pointerleave="cancel" @pointercancel="cancel"
    @keydown.enter.prevent="start" @keyup.enter="cancel" @keydown.space.prevent="start" @keyup.space="cancel" @contextmenu.prevent
  >
    <span class="word">SOS</span>
    <span class="hint">{{ t.child.sosHint }}</span>
    <span class="fill" aria-hidden="true" />
  </button>
</template>

<style scoped>
.sos {
  position: relative;
  overflow: hidden;
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
  touch-action: none;
  user-select: none;
}
.word,
.hint {
  position: relative;
  z-index: 1;
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
/* Remplissage pendant l'appui maintenu : l'enfant voit que quelque chose se passe. */
.fill {
  position: absolute;
  inset: 0;
  transform: scaleX(0);
  transform-origin: left;
  background: var(--sos-deep);
}
.holding .fill {
  transform: scaleX(1);
  transition: transform 3s linear;
}
</style>
