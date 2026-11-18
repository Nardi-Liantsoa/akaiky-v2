<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useT } from '../../composables/useT'
import QuickIcon from '../messages/QuickIcon.vue'
import { deviceSession, messageOutbox } from '../../lib/deviceSessionInstance'
import { formatClock } from '../../lib/format'
import { QUICK_SLOTS, QUICK_TINT, quickText, type QuickSlot } from '../../lib/quickMessages'
import { deviceConfig } from '../../composables/useDeviceConfig'

// « Dire à mes parents » (NAR-150, maquette écran 4) : 4 grandes tuiles (icône, couleur,
// texte). Un appui, un message : noté dans la file puis envoyé ; hors ligne, il part au
// retour du réseau. La confirmation devient « Maman l'a vu · 16:05 » dès qu'un parent l'a vu.
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
onBeforeUnmount(() => { clearInterval(poll); clearTimeout(unbusy) })

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
  return last.value.state === 'sent' ? t.value.child.quick.sent(text) : t.value.child.quick.queued(text)
})
</script>

<template>
  <Teleport to="body">
    <div class="quick" role="dialog" aria-modal="true" aria-labelledby="quick-title">
      <h2 id="quick-title">{{ t.child.quick.title }}</h2>
      <div class="tiles">
        <button
          v-for="slot in QUICK_SLOTS" :key="slot" type="button" class="tile" :style="{ background: QUICK_TINT[slot] }"
          :disabled="busy" @click="send(slot)"
        >
          <QuickIcon :kind="slot" :size="56" />
          <span>{{ label(slot) }}</span>
        </button>
      </div>
      <p class="toast" role="status">{{ toast }}</p>
      <button type="button" class="close" @click="emit('close')">{{ t.child.quick.close }}</button>
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
  gap: 16px;
  padding: calc(var(--safe-top) + 24px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(var(--gutter) + var(--safe-left));
  background: var(--bg-child);
  overflow-y: auto;
}
h2 {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 900;
  text-align: center;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
/* Tuiles bien plus grandes que 64 px : icône et couleur suffisent sans savoir lire. */
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 150px;
  padding: 16px 8px;
  border: 0;
  border-radius: 24px;
  color: var(--text);
  font: inherit;
  font-size: 1.15rem;
  font-weight: 900;
  text-align: center;
}
.tile:disabled {
  opacity: 0.6;
}
.tile:focus-visible,
.close:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.toast {
  min-height: 3em;
  margin: 0;
  text-align: center;
  font-weight: 800;
}
.close {
  align-self: center;
  min-height: 64px;
  min-width: 180px;
  border: 2px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
}
</style>
