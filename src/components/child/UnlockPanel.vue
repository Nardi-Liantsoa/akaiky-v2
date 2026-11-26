<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useT } from '../../composables/useT'
import { pushSheet } from '../../composables/useSheetStack'
import AppIcon from '../ui/AppIcon.vue'
import { unlockKiosk } from '../../composables/useKiosk'
import { unlockGuard } from '../../lib/deviceSessionInstance'
import { verifyParentCode } from '../../lib/parentCodeVerify'
import { UNLOCK_MINUTES } from '../../native/kiosk'

// Clavier du code parent sur le téléphone de l'enfant (NAR-167). Vérifié hors ligne
// contre le hachage de la configuration ; le bon code ouvre une sortie de 15 minutes.
// Chaque essai est compté AVANT la vérification (une app coupée en pleine vérification
// ne rend pas l'essai), puis effacé si le code est bon.
const props = defineProps<{ hash: string | null | undefined }>()
const emit = defineEmits<{ close: [], unlocked: [] }>()
const t = useT()
const digits = ref('')
const busy = ref(false)
const wrong = ref(false)
const failed = ref(false)
const waitMs = ref(0)
let tick: ReturnType<typeof setInterval> | undefined

async function refreshWait() {
  waitMs.value = await unlockGuard.waitMs().catch(() => 0)
}
// Retour d'Android : ferme le clavier, comme la flèche (jamais pendant la vérification).
let pop: (() => void) | undefined
onMounted(() => {
  pop = pushSheet(() => { if (!busy.value) emit('close') })
  void refreshWait()
  tick = setInterval(() => { if (waitMs.value > 0) void refreshWait() }, 1000)
})
onBeforeUnmount(() => { clearInterval(tick); pop?.() })

const blocked = computed(() => waitMs.value > 0)
const waitText = computed(() => {
  const total = Math.ceil(waitMs.value / 1000)
  return t.value.child.lock.wait(Math.floor(total / 60), total % 60)
})

function press(d: string) {
  if (busy.value || blocked.value || !props.hash || digits.value.length >= 6) return
  wrong.value = false
  failed.value = false
  digits.value += d
  if (digits.value.length === 6) void submit()
}
function erase() {
  if (!busy.value) digits.value = digits.value.slice(0, -1)
}

async function submit() {
  const code = digits.value
  const hash = props.hash
  if (!hash) return
  busy.value = true
  try {
    // Délai relu ici aussi : l'affichage seul ne fait pas foi.
    const pending = await unlockGuard.waitMs().catch(() => 0)
    if (pending > 0) { waitMs.value = pending; return }
    // Compteur illisible ou non écrit : l'essai se fait quand même (le parent ne doit pas
    // rester bloqué par une panne du Keystore ; l'enfant ne peut pas la provoquer).
    const wait = await unlockGuard.fail().catch(() => 0)
    if (await verifyParentCode(hash, code)) {
      await unlockGuard.succeed().catch(() => {})
      try {
        await unlockKiosk(UNLOCK_MINUTES)
        emit('unlocked')
      } catch {
        failed.value = true
      }
    } else {
      wrong.value = true
      waitMs.value = wait
    }
  } finally {
    digits.value = ''
    busy.value = false
  }
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <Teleport to="body">
    <!-- Code parent (planche 08, NAR-240) : flèche de retour hors du pavé, cadenas en tête ; après
         une erreur, points rouges et message juste dessous ; touches pleines. -->
    <div class="unlock" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
      <button type="button" class="back" :disabled="busy" :aria-label="t.child.lock.close" @click="emit('close')">
        <span class="back-ring" aria-hidden="true"><AppIcon name="chevron-left" :size="22" /></span>
      </button>
      <span class="badge" aria-hidden="true"><AppIcon name="lock" :size="26" /></span>
      <h2 id="unlock-title">{{ t.child.lock.title }}</h2>
      <p class="hint">{{ t.child.lock.hint }}</p>
      <template v-if="hash">
        <p class="dots" :class="{ bad: wrong && !digits }" role="status" :aria-label="t.child.lock.entered(digits.length)">
          <span v-for="i in 6" :key="i" :class="{ on: i <= digits.length || (wrong && !digits) }" />
        </p>
        <p v-if="busy" class="message" role="status">{{ t.child.lock.checking }}</p>
        <p v-else-if="blocked" class="message bad" role="alert">{{ waitText }}</p>
        <p v-else-if="wrong" class="message bad" role="alert">{{ t.child.lock.wrong }}</p>
        <p v-else-if="failed" class="message bad" role="alert">{{ t.child.lock.failed }}</p>
        <p v-else class="message" />
        <div class="pad">
          <button v-for="k in KEYS" :key="k" type="button" class="key" :disabled="busy || blocked" @click="press(k)">{{ k }}</button>
          <span class="key-gap" aria-hidden="true" />
          <button type="button" class="key" :disabled="busy || blocked" @click="press('0')">0</button>
          <button type="button" class="key key-erase" :disabled="busy || !digits" :aria-label="t.child.lock.erase" @click="erase"><AppIcon name="backspace" :size="28" /></button>
        </div>
      </template>
      <p v-else class="message">{{ t.child.lock.noCode }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.unlock {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: calc(var(--safe-top) + 12px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
  overflow-y: auto;
}
/* Flèche de retour en haut à gauche (visuel de 44 px, cible de 64 px). */
.back {
  display: grid;
  place-items: center;
  align-self: flex-start;
  width: var(--tap-child);
  height: var(--tap-child);
  margin-left: -10px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
}
.back-ring {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1.5px solid var(--border);
  border-radius: 50%;
  background: var(--surface);
}
/* Cadenas en tête : l'espace des parents. */
.badge {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--on-color);
}
h2 {
  margin: 8px 0 0;
  font-size: 1.8rem;
  font-weight: 900;
}
.hint {
  margin: 0;
  color: var(--text-soft);
}
.dots {
  display: flex;
  gap: 16px;
  margin: 16px 0 0;
}
.dots span {
  width: 18px;
  height: 18px;
  border: 2px solid var(--text);
  border-radius: 50%;
}
.dots span.on {
  background: var(--text);
}
/* Erreur : les points passent en rouge, le message juste dessous. */
.dots.bad span {
  border-color: var(--sos);
  background: var(--sos);
}
.message {
  /* Hauteur réservée : un message n'abaisse jamais les touches sous le doigt. */
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 3rem;
  margin: 4px 0;
  max-width: 24em;
  text-align: center;
  font-weight: 800;
}
.bad {
  color: var(--sos);
}
.pad {
  display: grid;
  grid-template-columns: repeat(3, 78px);
  gap: 12px 22px;
}
/* Touches pleines de 78 px (planche 08 ; ≥ --tap-child, 64 px) : doigts d'enfant et de parent pressé. */
.key {
  width: 78px;
  height: 78px;
  border: 0;
  border-radius: 50%;
  background: var(--surface-muted);
  color: var(--text);
  font: inherit;
  font-size: 1.8rem;
  font-weight: 800;
}
.key-erase {
  display: grid;
  place-items: center;
  background: none;
}
.key:disabled {
  opacity: 0.4;
}
.key-erase:disabled {
  opacity: 0.3;
}
.key:focus-visible,
.back:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
/* Écran court : le panneau défile, ses éléments ne rétrécissent jamais (cibles de 64 px gardées). */
.unlock > * {
  flex-shrink: 0;
}
</style>
