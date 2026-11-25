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
  <!-- Bouton compact (maquette allégée, NAR-237) : « SOS » seul, la consigne dessous. -->
  <div class="sos-dock">
    <button
      class="sos" :class="{ holding }" type="button" :aria-label="t.child.sosLabel"
      @pointerdown.prevent="start" @pointerup="cancel" @pointerleave="cancel" @pointercancel="cancel"
      @keydown.enter.prevent="start" @keyup.enter="cancel" @keydown.space.prevent="start" @keyup.space="cancel" @contextmenu.prevent
    >
      <span class="word">SOS</span>
      <span class="fill" aria-hidden="true" />
    </button>
    <p class="hint" aria-hidden="true">{{ t.child.sosHint }}</p>
  </div>
</template>

<style scoped>
.sos {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* 172 px de large (maquette) ; 64 px de haut au lieu de 60 : cible tactile de l'enfant
     (--tap-child, CdC §7.3). */
  width: 172px;
  min-height: var(--tap-child);
  border: none;
  border-radius: 999px;
  background: var(--sos);
  color: var(--on-color);
  box-shadow: 0 4px 12px rgb(196 42 30 / 0.28);
  font: inherit;
  touch-action: none;
  user-select: none;
}
/* Anneau de focus clavier bien visible (NAR-187) : dessiné hors du bouton, que le
 * débordement caché du remplissage ne rogne pas. */
.sos:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.sos-dock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.word {
  position: relative;
  z-index: 1;
  font-size: 1.5rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  line-height: 1;
}
.hint {
  margin: 0;
  color: var(--text-soft);
  font-size: 0.8rem;
  font-weight: 700;
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
