<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useT } from '../../composables/useT'

// Bouton SOS toujours visible. Maintenu 3 secondes, il émet `trigger` : l'accueil lance le SOS
// hors ligne (NAR-151 : SMS, cascade, sirène). Pendant l'appui (planche 10, NAR-239), tout
// l'écran le montre : voile rouge, compte à rebours, consigne, anneau autour du bouton. Lâcher
// avant la fin annule ; rien n'est lancé avant les 3 secondes.
const HOLD_MS = 3000
const SECONDS = HOLD_MS / 1000
const emit = defineEmits<{ trigger: [] }>()
const t = useT()
const holding = ref(false)
const elapsed = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined
let ticker: ReturnType<typeof setInterval> | undefined
let startedAt = 0

// Secondes restantes (3, 2, 1) et secondes passées (« 2 s sur 3 »).
const remaining = computed(() => Math.max(1, Math.ceil(SECONDS - elapsed.value / 1000)))
const done = computed(() => Math.min(SECONDS, Math.floor(elapsed.value / 1000)))

function start() {
  if (holding.value) return
  holding.value = true
  startedAt = Date.now()
  elapsed.value = 0
  ticker = setInterval(() => { elapsed.value = Date.now() - startedAt }, 100)
  timer = setTimeout(() => { stop(); emit('trigger') }, HOLD_MS)
}
function stop() {
  clearTimeout(timer)
  clearInterval(ticker)
  holding.value = false
  elapsed.value = 0
}
const cancel = stop
onBeforeUnmount(stop)
</script>

<template>
  <!-- Bouton compact (NAR-237) : « SOS » seul, la consigne dessous. -->
  <div class="sos-dock" :class="{ holding }">
    <span class="ring-box">
      <!-- Anneau de progression : fait le tour du bouton en 3 s, visible même sous le doigt. -->
      <svg v-if="holding" class="ring ring-pill" viewBox="0 0 196 88" aria-hidden="true">
        <rect x="3" y="3" width="190" height="82" rx="41" pathLength="100" />
      </svg>
      <!-- Paysage (NAR-242) : bouton rond, anneau rond. -->
      <svg v-if="holding" class="ring ring-round" viewBox="0 0 136 136" aria-hidden="true">
        <circle cx="68" cy="68" r="64" pathLength="100" transform="rotate(-90 68 68)" />
      </svg>
      <button
        class="sos" type="button" :aria-label="t.child.sosLabel"
        @pointerdown.prevent="start" @pointerup="cancel" @pointerleave="cancel" @pointercancel="cancel"
        @keydown.enter.prevent="start" @keyup.enter="cancel" @keydown.space.prevent="start" @keyup.space="cancel" @contextmenu.prevent
      >
        <span class="word">SOS</span>
      </button>
    </span>
    <p class="hint" aria-hidden="true">{{ holding ? t.child.sos.holdProgress(done, SECONDS) : t.child.sosHint }}</p>
    <!-- Toujours dans le DOM, polie : la consigne est lue une fois au début de l'appui. -->
    <p class="visually-hidden" aria-live="polite">{{ holding ? `${t.child.sos.holdTitle} ${t.child.sos.holdText}` : '' }}</p>
  </div>
  <!-- Voile plein écran pendant l'appui : ne capte aucun toucher (le doigt reste sur le bouton). -->
  <Teleport to="body">
    <div v-if="holding" class="sos-veil" aria-hidden="true">
      <p class="count">{{ remaining }}</p>
      <p class="veil-title">{{ t.child.sos.holdTitle }}</p>
      <p class="veil-text">{{ t.child.sos.holdText }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.sos-dock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
/* Pendant l'appui, le bouton passe au-dessus du voile. */
.sos-dock.holding {
  position: relative;
  z-index: 46;
}
.ring-box {
  position: relative;
  display: grid;
  place-items: center;
}
.ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 196px;
  height: 88px;
  transform: translate(-50%, -50%);
  overflow: visible;
  pointer-events: none;
}
.ring-round {
  display: none;
}
.ring rect,
.ring circle {
  fill: none;
  stroke: var(--on-color);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: ring-fill 3s linear forwards;
}
@keyframes ring-fill {
  to {
    stroke-dashoffset: 0;
  }
}
.sos {
  position: relative;
  display: flex;
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
/* Halo pendant l'appui ; jamais de changement de taille : le doigt ne doit pas sortir du bouton
   (pointerleave annulerait). */
.holding .sos {
  box-shadow: 0 0 0 10px var(--on-color-fill);
}
/* Anneau de focus clavier bien visible (NAR-187). */
.sos:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.word {
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
.holding .hint {
  color: var(--sos-veil-ink);
}
.sos-veil {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: calc(var(--safe-top) + 18vh) 32px 0;
  background: var(--sos-veil);
  color: var(--on-color);
  text-align: center;
  pointer-events: none;
}
.sos-veil p {
  margin: 0;
}
.count {
  font-size: 6rem;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.veil-title {
  font-size: 1.4rem;
  font-weight: 900;
}
.veil-text {
  max-width: 16rem;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.45;
  opacity: 0.85;
}
/* Paysage (planche 06, NAR-242) : SOS rond de 112 px dans la colonne de droite. */
@media (orientation: landscape) and (max-height: 500px) {
  .sos {
    width: 112px;
    height: 112px;
    border-radius: 50%;
  }
  .ring-pill {
    display: none;
  }
  .ring-round {
    display: block;
    width: 136px;
    height: 136px;
  }
  .hint {
    max-width: 120px;
    text-align: center;
  }
}
</style>
