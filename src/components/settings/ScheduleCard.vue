<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { createSchedule, deleteSchedule, getSchedules, updateSchedule, type Schedule, type ScheduleInput } from '../../api/schedules'
import { useConfirm } from '../../composables/useConfirm'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { clock, daysSummary, fromTimeInput, toTimeInput } from '../../lib/schedule'
import { canManage } from '../../store/family'
import { contacts } from '../../store/contacts'
import AppButton from '../ui/AppButton.vue'
import ConfirmSheet from '../ui/ConfirmSheet.vue'
import StatusBlock from '../ui/StatusBlock.vue'

// Plages horaires « école » d'un enfant (NAR-148, maquette écran 8). Un gestionnaire les
// crée, modifie, active ou supprime ; un contact les voit. Le téléphone les applique seul.
const props = defineProps<{ childId: string }>()
const t = useT()

const items = ref<Schedule[]>([])
const status = ref<'loading' | 'ready' | 'error'>('loading')
const error = ref('')
// Enfant dont une écriture est en cours : seul lui est bloqué ; changer d'enfant ne
// bloque pas l'autre (sa liste est relue au retour, donc toujours exacte).
const saving = ref(new Set<string>())
const busy = computed(() => saving.value.has(props.childId))
// Formulaire : null fermé, 'new' pour une création, sinon l'identifiant modifié.
const editing = ref<string | null>(null)
const label = ref('')
const days = ref(0)
const start = ref('')
const end = ref('')
const formError = ref('')

let loadId = 0
async function load(childId: string) {
  const id = ++loadId
  status.value = 'loading'
  error.value = ''
  try {
    const list = await getSchedules(childId)
    if (id !== loadId) return
    items.value = list
    status.value = 'ready'
  } catch (e) {
    if (id !== loadId) return
    error.value = errorText(e, t.value)
    status.value = 'error'
  }
}
// Retrait confirmé par la feuille commune (NAR-184) : rien ne part avant « Confirmer ».
const confirming = useConfirm<Schedule>()
// Autre enfant : formulaire et confirmation refermés, liste rechargée.
watch(() => props.childId, (id) => { close(); confirming.close(); void load(id) }, { immediate: true })

function open(s?: Schedule) {
  editing.value = s?.id ?? 'new'
  label.value = s?.label ?? t.value.schedules.defaultLabel
  days.value = s?.days ?? 0b0011111
  start.value = toTimeInput(s?.startMin ?? 8 * 60)
  end.value = toTimeInput(s?.endMin ?? 16 * 60)
  formError.value = ''
}
function close() { editing.value = null; formError.value = '' }
const toggleDay = (d: number) => { days.value ^= 1 << d }
const crossesMidnight = computed(() => {
  const a = fromTimeInput(start.value), b = fromTimeInput(end.value)
  return a !== null && b !== null && b < a
})

function input(): ScheduleInput | null {
  const startMin = fromTimeInput(start.value), endMin = fromTimeInput(end.value)
  const name = label.value.trim()
  if (!name || [...name].length > 30) { formError.value = t.value.schedules.invalidLabel; return null }
  if (!days.value) { formError.value = t.value.schedules.noDays; return null }
  if (startMin === null || endMin === null || startMin === endMin) { formError.value = t.value.schedules.invalidTimes; return null }
  const current = items.value.find((s) => s.id === editing.value)
  return { label: name, days: days.value, startMin, endMin, enabled: current?.enabled ?? true }
}

// Chaque écriture vise l'enfant affiché au moment du clic ; la réponse n'est appliquée
// que s'il l'est encore.
async function run(childId: string, action: () => Promise<void>) {
  if (saving.value.has(childId)) return
  saving.value.add(childId)
  error.value = ''
  try {
    await action()
  } catch (e) {
    if (childId === props.childId) { if (editing.value) formError.value = errorText(e, t.value); else error.value = errorText(e, t.value) }
  } finally {
    saving.value.delete(childId)
  }
}
function save() {
  const data = input()
  if (!data) return
  const childId = props.childId
  const id = editing.value
  void run(childId, async () => {
    const saved = id === 'new' ? await createSchedule(childId, data) : await updateSchedule(childId, id!, data)
    if (childId !== props.childId) return
    items.value = id === 'new' ? [...items.value, saved] : items.value.map((s) => (s.id === saved.id ? saved : s))
    close()
  })
}
function toggle(s: Schedule) {
  const childId = props.childId
  void run(childId, async () => {
    const saved = await updateSchedule(childId, s.id, { label: s.label, days: s.days, startMin: s.startMin, endMin: s.endMin, enabled: !s.enabled })
    if (childId === props.childId) items.value = items.value.map((x) => (x.id === saved.id ? saved : x))
  })
}
async function remove() {
  const s = confirming.target.value
  if (!s) return
  const childId = props.childId
  await run(childId, async () => {
    await deleteSchedule(childId, s.id)
    if (childId === props.childId) items.value = items.value.filter((x) => x.id !== s.id)
  })
  // Erreur montrée dans la carte, feuille refermée (sauf si une autre a été ouverte
  // entre-temps, pour un autre enfant).
  if (confirming.target.value === s) confirming.close()
}
const summary = (s: Schedule) => t.value.schedules.summary(daysSummary(s.days, t.value.schedules.days, t.value.schedules.everyDay), clock(s.startMin), clock(s.endMin))
const sorted = computed(() => [...items.value].sort((a, b) => a.startMin - b.startMin))
// Aucun contact relié à un parent (owner, manager) : pendant une plage, personne ne
// pourra appeler l'enfant ni être appelé, hors secours (NAR-176). Dit avant que ça arrive.
const noParent = computed(() => items.value.some((s) => s.enabled) && contacts.childId === props.childId && contacts.status === 'ready'
  && !contacts.items.some((c) => c.memberRole === 'owner' || c.memberRole === 'manager'))
</script>

<template>
  <section id="plages" class="card schedules" tabindex="-1">
    <h2>{{ t.schedules.title }}</h2>
    <p class="hint">{{ t.schedules.hint }}</p>
    <StatusBlock v-if="status === 'error'" state="error" :text="`${t.schedules.loadError} ${error}`" @retry="load(childId)" />
    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="noParent" class="warning" role="status">{{ t.schedules.noParent }}</p>
      <ul v-if="sorted.length" class="list" :aria-busy="status === 'loading'" :class="{ refreshing: status === 'loading' }">
        <li v-for="s in sorted" :key="s.id" class="item" :class="{ off: !s.enabled }">
          <div class="text">
            <p class="name">{{ s.label }}</p>
            <p class="when">{{ summary(s) }}</p>
          </div>
          <template v-if="canManage()">
            <button
              type="button" role="switch" class="toggle" :aria-checked="s.enabled" :disabled="busy"
              :aria-label="t.schedules.toggle(s.label)" @click="toggle(s)"
            ><span class="knob" /></button>
            <div class="row-actions">
              <AppButton variant="link" :disabled="busy" @click="open(s)">{{ t.schedules.edit }}</AppButton>
              <AppButton variant="danger-link" :disabled="busy" @click="confirming.ask(s, $event)">{{ t.schedules.remove }}</AppButton>
            </div>
          </template>
          <p v-else class="state">{{ s.enabled ? t.schedules.on : t.schedules.off }}</p>
        </li>
      </ul>
      <StatusBlock v-else-if="status === 'ready'" state="empty" :text="t.schedules.empty" />
      <ConfirmSheet
        v-if="confirming.target.value" id="schedule-remove" :title="t.schedules.removeTitle(confirming.target.value.label)"
        :items="t.schedules.removeItems" :confirm="t.schedules.confirmRemove" :busy="busy" :opener="confirming.opener.value"
        @close="confirming.close()" @confirm="remove"
      />

      <form v-if="editing" class="form" @submit.prevent="save">
        <h3>{{ editing === 'new' ? t.schedules.add : t.schedules.editTitle }}</h3>
        <p v-if="formError" class="error" role="alert">{{ formError }}</p>
        <div class="field">
          <label for="schedule-label">{{ t.schedules.label }}</label>
          <input id="schedule-label" v-model="label" class="input" type="text" autocomplete="off" />
        </div>
        <fieldset class="days">
          <legend>{{ t.schedules.daysLabel }}</legend>
          <button
            v-for="(name, d) in t.schedules.days" :key="d" type="button" class="day"
            :aria-pressed="!!(days & (1 << d))" :aria-label="t.schedules.dayNames[d]" @click="toggleDay(d)"
          >{{ name }}</button>
        </fieldset>
        <div class="times">
          <div class="field">
            <label for="schedule-start">{{ t.schedules.start }}</label>
            <input id="schedule-start" v-model="start" class="input" type="time" required />
          </div>
          <div class="field">
            <label for="schedule-end">{{ t.schedules.end }}</label>
            <input id="schedule-end" v-model="end" class="input" type="time" required />
          </div>
        </div>
        <p v-if="crossesMidnight" class="note">{{ t.schedules.overnight }}</p>
        <div class="form-actions">
          <AppButton type="submit" :disabled="busy">{{ t.schedules.save }}</AppButton>
          <AppButton variant="ghost" :disabled="busy" @click="close">{{ t.schedules.cancel }}</AppButton>
        </div>
      </form>
      <AppButton v-else-if="canManage() && status === 'ready'" variant="ghost" @click="open()">+ {{ t.schedules.add }}</AppButton>
    </template>
  </section>
</template>

<style scoped>
.schedules {
  margin-top: 16px;
}
h2 {
  margin: 0;
}
h3 {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 800;
}
.hint {
  margin: 4px 0 12px;
  color: var(--text-soft);
}
.refreshing {
  opacity: 0.55;
  pointer-events: none;
}
.list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 10px 0;
}
.item + .item {
  border-top: 1px solid var(--border);
}
.item.off .text {
  opacity: 0.6;
}
.text {
  flex: 1 1 160px;
  min-width: 0;
}
.name {
  margin: 0;
  font-weight: 800;
}
.when {
  margin: 2px 0 0;
  color: var(--text-soft);
}
.state {
  margin: 0;
  font-weight: 700;
}
/* Interrupteur : 52 × 32, zone tactile agrandie par le padding. */
.toggle {
  position: relative;
  flex: none;
  width: 52px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--border-strong);
  cursor: pointer;
}
/* Zone tactile de 48 px de haut, dessin inchangé. */
.toggle::after {
  content: '';
  position: absolute;
  inset: -8px 0;
}
.toggle[aria-checked='true'] {
  background: var(--accent);
}
.knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform 0.15s;
}
.toggle[aria-checked='true'] .knob {
  transform: translateX(20px);
}
.toggle:focus-visible,
.day:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.row-actions {
  display: flex;
  flex: 1 0 100%;
  gap: 16px;
}
.warning {
  margin: 0 0 12px;
  padding: 10px 14px;
  border-radius: 14px;
  background: var(--tint-butter);
  font-weight: 700;
}
.form {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 12px;
  padding: 0;
  border: 0;
}
.days legend {
  margin-bottom: 6px;
  font-weight: 700;
}
.day {
  min-width: var(--tap);
  min-height: var(--tap);
  padding: 0 8px;
  border: 2px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.day[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-color);
}
.times {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.note {
  margin: 0 0 8px;
  color: var(--text-soft);
  font-weight: 700;
}
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
