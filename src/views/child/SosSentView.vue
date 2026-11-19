<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useT } from '../../composables/useT'
import { pushSheet } from '../../composables/useSheetStack'
import type { SosState } from '../../native/akaikySos'

// SOS envoyé (NAR-151, maquette écran 3) : fond rouge, étapes suivies en direct par le
// service natif (SMS aux parents, cascade d'appels, position dans le SMS), secours, annuler.
// `plannedCalls` : ordre prévu (src/lib/sosCascade.ts), montré avant le premier état natif.
const props = defineProps<{ state: SosState | null, plannedCalls: string[], emergency: string }>()
const emit = defineEmits<{ cancel: [], close: [], emergency: [] }>()
const t = useT()

const status = computed(() => props.state?.status ?? 'starting')
const running = computed(() => props.state?.active !== false && (status.value === 'starting' || status.value === 'calling' || status.value === 'emergency'))
const calls = computed(() => props.state?.calls ?? props.plannedCalls)

const smsText = computed(() => {
  const s = t.value.child.sos
  const list = props.state?.sms
  if (!list) return s.smsSending
  if (!list.length) return s.smsNone
  const sent = list.filter((x) => x.status === 'sent').length
  if (sent === list.length) return s.smsSent
  if (list.some((x) => x.status === 'pending')) return s.smsSending
  return sent ? s.smsPartial(sent, list.length) : s.smsFailed
})
const smsDone = computed(() => !!props.state?.sms?.length && props.state.sms.every((x) => x.status === 'sent'))

const callText = computed(() => {
  const s = t.value.child.sos
  const st = props.state
  if (status.value === 'answered') return st?.answeredBy === 'incoming' ? s.incoming : s.answered(st?.answeredBy ?? '')
  if (status.value === 'emergency') return (st?.index ?? calls.value.length) < calls.value.length ? s.emergencyChosen : s.exhausted
  if (!calls.value.length) return s.exhausted
  const i = status.value === 'calling' ? Math.min(st?.index ?? 0, calls.value.length - 1) : 0
  return s.calling(calls.value[i], calls.value.slice(i + 1))
})

const positionText = computed(() => {
  const known = props.state?.positionKnown
  if (known === undefined) return null
  return known ? t.value.child.sos.position : t.value.child.sos.positionUnknown
})

// Bouton retour d'Android : ne ferme l'écran qu'une fois le SOS fini (jamais d'annulation
// par erreur, l'enfant a « Annuler »).
let pop: (() => void) | undefined
onMounted(() => { pop = pushSheet(() => { if (!running.value) emit('close') }) })
onBeforeUnmount(() => pop?.())
</script>

<template>
  <Teleport to="body">
    <section class="sos-sent" role="dialog" aria-modal="true" aria-labelledby="sos-sent-title">
      <h1 id="sos-sent-title">{{ status === 'cancelled' ? t.child.sos.cancelled : t.child.sos.title }}</h1>
      <ol v-if="status !== 'cancelled'" class="steps" aria-live="polite">
        <li :class="{ done: smsDone }">{{ smsText }}</li>
        <li :class="{ done: status === 'answered', current: status === 'calling' }">{{ callText }}</li>
        <li v-if="positionText" :class="{ done: state?.positionKnown }">{{ positionText }}</li>
        <li v-if="state?.siren" class="siren">{{ t.child.sos.siren }}</li>
      </ol>
      <div class="actions">
        <button class="call-emergency" type="button" @click="emit('emergency')">{{ t.child.sos.callEmergency(emergency) }}</button>
        <button v-if="running" class="cancel" type="button" @click="emit('cancel')">{{ t.child.sos.cancel }}</button>
        <button v-else class="cancel" type="button" @click="emit('close')">{{ t.child.sos.close }}</button>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.sos-sent {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: calc(var(--safe-top) + 32px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(var(--gutter) + var(--safe-left));
  overflow-y: auto;
  background: var(--sos-deep);
  color: var(--on-color);
}
h1 {
  margin: 0;
  font-size: 2.2rem;
  font-weight: 900;
  text-align: center;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.steps li {
  padding: 16px 18px;
  border: 2px solid transparent;
  border-radius: 20px;
  background: var(--sos);
  font-size: 1.15rem;
  font-weight: 800;
}
.steps li.current {
  border-color: var(--on-color);
}
.steps li.done::before {
  content: '✓ ';
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: auto;
}
.call-emergency,
.cancel {
  min-height: var(--tap-child);
  border-radius: var(--radius-pill);
  font: inherit;
  font-size: 1.15rem;
  font-weight: 900;
}
.call-emergency {
  border: 0;
  background: var(--surface);
  color: var(--sos);
}
.cancel {
  border: 2px solid currentcolor;
  background: transparent;
  color: var(--on-color);
}
</style>
