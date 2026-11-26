<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useT } from '../../composables/useT'
import AppIcon from '../../components/ui/AppIcon.vue'
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

// Maquette allégée (planches 11 et 12, NAR-239). Cascade épuisée : personne n'a répondu, la
// carte blanche porte l'appel aux secours. Écran de fin : alerte finie, ou cascade épuisée.
const exhausted = computed(() => status.value === 'emergency' && (props.state?.index ?? calls.value.length) >= calls.value.length)
const finished = computed(() => !running.value || exhausted.value)
const current = computed(() => (status.value === 'calling' ? calls.value[Math.min(props.state?.index ?? 0, calls.value.length - 1)] : undefined))
// À venir : après le contact appelé, ou toute la liste avant le premier appel.
const upcoming = computed(() => {
  if (status.value === 'calling') return calls.value.slice(Math.min(props.state?.index ?? 0, calls.value.length - 1) + 1)
  if (status.value === 'starting') return calls.value
  return []
})
// Échec : au moins un SMS prévu et aucun en attente sans que tous soient partis. Liste vide
// (aucun contact à prévenir) : neutre, jamais un échec.
const smsFailed = computed(() => !!props.state?.sms?.length && !props.state.sms.some((x) => x.status === 'pending') && !smsDone.value)
const smsNone = computed(() => props.state?.sms?.length === 0)
const smsSub = computed(() => {
  const known = props.state?.positionKnown
  if (known === undefined) return ''
  return known ? t.value.child.sos.withPosition : t.value.child.sos.withoutPosition
})
const initialOf = (name: string) => [...name.trim()][0]?.toUpperCase() ?? ''

// Bouton retour d'Android : ne ferme l'écran qu'une fois le SOS fini (jamais d'annulation
// par erreur, l'enfant a « Annuler »).
let pop: (() => void) | undefined
onMounted(() => { pop = pushSheet(() => { if (finished.value) emit('close') }) })
onBeforeUnmount(() => pop?.())
</script>

<template>
  <Teleport to="body">
    <section class="sos-sent" role="dialog" aria-modal="true" aria-labelledby="sos-sent-title">
      <!-- SOS en cours (planche 11) : étapes faites, en cours, à venir ; secours, « Annuler l'alerte ». -->
      <template v-if="status !== 'cancelled' && !finished">
        <header class="head">
          <p class="eyebrow">{{ t.child.sos.running }}</p>
          <h1 id="sos-sent-title">{{ t.child.sos.headline }}</h1>
        </header>
        <ol class="steps" aria-live="polite">
          <li class="step" :class="{ muted: !smsDone && !smsFailed && !smsNone }">
            <span class="ic" :class="smsDone ? 'ok' : smsFailed ? 'warn' : smsNone ? 'none' : 'wait'" aria-hidden="true">
              <AppIcon v-if="smsDone" name="check" :size="18" />
              <span v-else-if="smsFailed">!</span>
            </span>
            <span class="txt"><span class="lb">{{ smsDone ? t.child.sos.smsSentShort : smsText }}</span><span v-if="smsSub" class="sm">{{ smsSub }}</span></span>
          </li>
          <li v-if="status === 'emergency'" class="step">
            <span class="ic now" aria-hidden="true"><AppIcon name="phone" :size="18" /></span>
            <span class="txt"><span class="lb">{{ t.child.sos.emergencyChosen }}</span></span>
          </li>
          <li v-else-if="current" class="step">
            <span class="ic now" aria-hidden="true">{{ initialOf(current) }}</span>
            <span class="txt"><span class="lb">{{ t.child.sos.callingNow(current) }}</span><span class="sm">{{ t.child.sos.ringing }}</span></span>
          </li>
          <li v-if="upcoming.length" class="step muted">
            <span class="ic wait" aria-hidden="true" />
            <span class="txt">
              <span class="lb">{{ t.child.sos.next(upcoming.join(', ')) }}</span>
              <span v-if="current" class="sm">{{ t.child.sos.nextIf(current) }}</span>
            </span>
          </li>
          <li v-if="state?.siren" class="step muted">
            <span class="ic wait" aria-hidden="true"><AppIcon name="siren" :size="16" /></span>
            <span class="txt"><span class="lb">{{ t.child.sos.siren }}</span></span>
          </li>
        </ol>
        <div class="actions">
          <button class="call-emergency" type="button" @click="emit('emergency')">{{ t.child.sos.callEmergency(emergency) }}</button>
          <button class="cancel" type="button" @click="emit('cancel')">{{ t.child.sos.cancelAlert }}</button>
        </div>
      </template>
      <!-- Alerte envoyée (planche 12) : réussites en coches ; personne n'a répondu : carte blanche. -->
      <template v-else>
        <h1 id="sos-sent-title" class="done-title">{{ status === 'cancelled' ? t.child.sos.cancelled : status === 'failed' ? t.child.sos.failedTitle : t.child.sos.title }}</h1>
        <ul v-if="status !== 'cancelled'" class="oks" aria-live="polite">
          <li v-if="state?.sms">
            <span class="ic" :class="smsDone ? 'ok' : smsNone ? 'none' : 'warn'" aria-hidden="true"><AppIcon v-if="smsDone" name="check" :size="16" /><span v-else-if="!smsNone">!</span></span>
            {{ smsDone ? t.child.sos.sentSms : smsText }}
          </li>
          <li v-if="positionText">
            <span class="ic" :class="state?.positionKnown ? 'ok' : 'warn'" aria-hidden="true"><AppIcon v-if="state?.positionKnown" name="check" :size="16" /><span v-else>!</span></span>
            {{ positionText }}
          </li>
          <li v-if="status === 'answered'">
            <span class="ic ok" aria-hidden="true"><AppIcon name="check" :size="16" /></span>
            {{ callText }}
          </li>
        </ul>
        <div v-if="exhausted || status === 'failed'" class="no-answer">
          <p v-if="exhausted" class="no-answer-title">{{ t.child.sos.noAnswerTitle }}</p>
          <p class="no-answer-text">{{ t.child.sos.noAnswerText }}</p>
          <button class="call-number" type="button" @click="emit('emergency')"><AppIcon name="phone" :size="22" />{{ t.child.sos.callNumber(emergency) }}</button>
        </div>
        <div v-else-if="status !== 'cancelled'" class="actions">
          <button class="call-emergency" type="button" @click="emit('emergency')">{{ t.child.sos.callEmergency(emergency) }}</button>
        </div>
        <!-- « Fermer » discret : il ne concurrence pas l'appel aux secours. Il cache seulement l'écran :
             cascade épuisée, le service continue (sirène gardée sur le composeur des secours). -->
        <button class="close-link" type="button" :class="{ alone: status === 'cancelled' }" @click="emit('close')">{{ t.child.sos.close }}</button>
      </template>
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
  gap: 22px;
  padding: calc(var(--safe-top) + 20px) calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 24px) calc(var(--gutter) + var(--safe-left));
  overflow-y: auto;
  background: var(--sos-deep);
  color: var(--on-color);
}
.head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 8px;
}
.eyebrow {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.8;
}
h1 {
  margin: 0;
  font-size: 1.9rem;
  font-weight: 900;
  line-height: 1.15;
}
/* Étapes (planche 11) : une carte translucide, lignes séparées d'un filet. */
.steps {
  margin: 0;
  padding: 4px 18px;
  border-radius: 22px;
  background: var(--on-color-fill);
  list-style: none;
}
.step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
}
.step + .step {
  border-top: 1px solid var(--on-color-line);
}
.step.muted {
  opacity: 0.6;
}
.ic {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-weight: 900;
}
.ic.ok {
  background: var(--on-color);
  color: var(--sos-deep);
}
.ic.none {
  border: 2px solid var(--on-color-line);
}
.ic.warn {
  background: var(--warning-bg);
  color: var(--warning-ink);
}
.ic.now {
  background: var(--accent-orange-deep);
  color: var(--on-color);
}
.ic.wait {
  border: 2px dashed var(--on-color-line);
}
.txt {
  display: flex;
  flex-direction: column;
}
.lb {
  font-size: 1.05rem;
  font-weight: 800;
  line-height: 1.3;
}
.sm {
  font-size: 0.85rem;
  font-weight: 600;
  opacity: 0.8;
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
  font-weight: 800;
}
.call-emergency {
  border: 0;
  background: var(--surface);
  color: var(--sos);
  font-size: 1.15rem;
}
.cancel {
  border: 1.5px solid var(--on-color-line);
  background: transparent;
  color: var(--on-color);
  font-size: 1rem;
}
/* Alerte envoyée (planche 12). */
.done-title {
  padding: 0 8px;
}
.oks {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
  padding: 0 8px;
  list-style: none;
}
.oks li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1rem;
  font-weight: 800;
}
.oks .ic {
  width: 28px;
  height: 28px;
}
.no-answer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding: 22px 20px 20px;
  border-radius: 24px;
  background: var(--surface);
  color: var(--ink);
}
.no-answer p {
  margin: 0;
}
.no-answer-title {
  color: var(--sos);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.no-answer-text {
  font-size: 1.3rem;
  font-weight: 900;
  line-height: 1.25;
}
.call-number {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: var(--tap-child);
  margin-top: 8px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--sos);
  color: var(--on-color);
  font: inherit;
  font-size: 1.2rem;
  font-weight: 800;
}
.close-link {
  align-self: center;
  min-height: var(--tap-child);
  padding: 0 24px;
  border: 0;
  background: none;
  color: var(--on-color);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
}
.close-link.alone {
  margin-top: auto;
}
.call-emergency:focus-visible,
.cancel:focus-visible,
.call-number:focus-visible,
.close-link:focus-visible {
  outline: 3px solid var(--on-color);
  outline-offset: 3px;
}
</style>
