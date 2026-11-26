<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useT } from '../../composables/useT'
import QuickIcon from '../messages/QuickIcon.vue'
import { deviceSession, messageOutbox } from '../../lib/deviceSessionInstance'
import { formatClock } from '../../lib/format'
import { QUICK_SLOTS, QUICK_TINT, quickText, type QuickSlot } from '../../lib/quickMessages'
import { deviceConfig } from '../../composables/useDeviceConfig'
import { pushSheet } from '../../composables/useSheetStack'
import AppIcon from '../ui/AppIcon.vue'

// « Dire à mes parents » (NAR-150 ; planche 07, NAR-240) : flèche de retour, phrase d'aide (« ta
// famille le reçoit » : chaque membre reçoit le message, pas seulement les parents), 4 grandes tuiles (icône, couleur, texte), la tuile envoyée cochée. Un appui,
// un message : noté dans la file puis envoyé ; hors ligne, il part au retour du réseau. La
// confirmation, en bas, dit qu'il est parti, puis « Maman l'a vu · 16:05 ».
// sent : coche et contour seulement une fois le message parti (pas en file hors ligne).
const sentSlot = computed(() => (last.value && (last.value.state === 'sent' || seen.value) ? last.value.slot : null))
const emit = defineEmits<{ close: [] }>()
const t = useT()
const busy = ref(false)
// text : le texte affiché au moment de l'appui (une configuration reçue ensuite ne le change pas).
const last = ref<{ id: string, slot: QuickSlot, text: string, state: 'queued' | 'sent' | 'refused' } | null>(null)
const seen = ref<{ name: string, readAt: string } | null>(null)
let unbusy: ReturnType<typeof setTimeout> | undefined
// Génération : une relecture lancée pour le message précédent ne marque jamais le nouveau.
let generation = 0

interface PhoneMessage { id: string, readBy: { name: string, readAt: string }[] }
// « Vu » relu toutes les 15 s tant que l'écran est ouvert ; un message parti plus tard
// depuis la file (retour du réseau) est reconnu ici aussi.
async function refreshSeen() {
  const current = last.value
  const gen = generation
  if (!current || current.state === 'refused' || seen.value) return
  const list = await deviceSession.get<PhoneMessage[]>('/device/messages').catch(() => null)
  const mine = list?.find((m) => m.id === current.id)
  if (!mine || gen !== generation || last.value?.id !== current.id) return
  current.state = 'sent'
  if (mine.readBy.length) seen.value = mine.readBy[0]
}
const poll = setInterval(() => { void refreshSeen() }, 15_000)
// Retour d'Android : ferme le panneau, comme la flèche.
let pop: (() => void) | undefined
onMounted(() => { pop = pushSheet(() => emit('close')) })
onBeforeUnmount(() => { clearInterval(poll); clearTimeout(unbusy); pop?.() })


async function send(slot: QuickSlot) {
  if (busy.value) return
  // Pas d'envoi en rafale : un appui de plus ne part qu'après un court délai.
  busy.value = true
  unbusy = setTimeout(() => { busy.value = false }, 1500)
  generation++
  seen.value = null
  last.value = null
  const message = await messageOutbox.add(slot).catch(() => null)
  if (!message) return
  last.value = { id: message.id, slot, text: label(slot), state: 'queued' }
  const result = await messageOutbox.flush().catch(() => null)
  if (last.value?.id !== message.id || !result) return
  if (result.sent.includes(message.id)) last.value.state = 'sent'
  else if (result.refused.includes(message.id)) last.value.state = 'refused'
}

// Texte du message : celui choisi par un parent (configuration du téléphone), sinon le défaut.
const label = (slot: QuickSlot) => quickText(slot, t.value.child.quick.texts, deviceConfig.config?.messageTexts?.[slot])

const toast = computed(() => {
  if (!last.value) return ''
  const text = last.value.text
  if (seen.value) return `${t.value.child.quick.sent(text)} · ${t.value.child.quick.seen(seen.value.name, formatClock(new Date(seen.value.readAt)))}`
  if (last.value.state === 'refused') return t.value.child.quick.refused(text)
  return last.value.state === 'sent' ? t.value.child.quick.sentTo(text) : t.value.child.quick.queued(text)
})
const toastKind = computed(() => (last.value?.state === 'refused' ? 'bad' : last.value?.state === 'queued' && !seen.value ? 'wait' : 'ok'))
</script>

<template>
  <Teleport to="body">
    <div class="quick" role="dialog" aria-modal="true" aria-labelledby="quick-title">
      <header class="head">
        <!-- Flèche de retour (visuel de 44 px, cible de 64 px), comme partout sur Android. -->
        <button type="button" class="back" :aria-label="t.child.quick.close" @click="emit('close')">
          <span class="back-ring" aria-hidden="true"><AppIcon name="chevron-left" :size="22" /></span>
        </button>
        <h2 id="quick-title">{{ t.child.quick.title }}</h2>
      </header>
      <p class="quick-help">{{ t.child.quick.help }}</p>
      <div class="tiles">
        <button
          v-for="slot in QUICK_SLOTS" :key="slot" type="button" class="tile" :class="{ sent: sentSlot === slot }"
          :style="{ background: QUICK_TINT[slot] }" :disabled="busy" @click="send(slot)"
        >
          <span v-if="sentSlot === slot" class="check" aria-hidden="true"><AppIcon name="check" :size="16" /></span>
          <QuickIcon :kind="slot" :size="48" />
          <span>{{ label(slot) }}</span>
        </button>
      </div>
      <!-- Confirmation en bas (zone annoncée toujours présente, vide tant que rien n'est parti). -->
      <p class="toast" :class="[toastKind, { empty: !toast }]" role="status">
        <span v-if="toast" class="toast-ic" aria-hidden="true"><AppIcon v-if="toastKind !== 'bad'" :name="toastKind === 'wait' ? 'clock' : 'check'" :size="18" /><span v-else>!</span></span>
        <span>{{ toast }}</span>
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.quick {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: calc(var(--safe-top) + 12px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 20px) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
  overflow-y: auto;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: -10px;
}
.back {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--tap-child);
  height: var(--tap-child);
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
h2 {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 900;
}
.quick-help {
  margin: -6px 0 0;
  color: var(--text-soft);
  font-weight: 600;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
/* Tuiles bien plus grandes que 64 px : icône et couleur suffisent sans savoir lire. */
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 140px;
  padding: 16px 8px;
  border: 3px solid transparent;
  border-radius: 24px;
  color: var(--text);
  font: inherit;
  font-size: 1.1rem;
  font-weight: 800;
  text-align: center;
}
/* Tuile envoyée : contour et coche, l'enfant voit ce qu'il a touché. */
.tile.sent {
  border-color: var(--call);
}
.check {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--call);
  color: var(--on-color);
}
.tile:disabled {
  opacity: 0.6;
}
.tile.sent:disabled {
  opacity: 1;
}
.tile:focus-visible,
.back:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
/* Confirmation en bas (planche 07) : bandeau sombre, pastille verte. */
.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: auto 0 0;
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--ink);
  color: var(--on-color);
  font-weight: 700;
}
.toast.empty {
  visibility: hidden;
}
.toast-ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--call);
  color: var(--on-color);
  font-weight: 900;
}
.toast.wait .toast-ic {
  background: var(--text-soft);
}
.toast.bad .toast-ic {
  background: var(--sos);
}
/* Écran court : le panneau défile, ses éléments ne rétrécissent jamais (cibles de 64 px gardées). */
.quick > * {
  flex-shrink: 0;
}
</style>
