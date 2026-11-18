<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getTemplates, putTemplate, type MessageTemplate } from '../../api/messages'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { QUICK_SLOTS, QUICK_TEXT_MAX, QUICK_TINT, textLength, type QuickSlot } from '../../lib/quickMessages'
import { canManage } from '../../store/family'
import QuickIcon from '../messages/QuickIcon.vue'

// Textes des 4 messages rapides d'un enfant (NAR-173). Un gestionnaire les modifie ; un
// contact les voit. Un champ vide ou « Texte par défaut » remet le texte traduit.
const props = defineProps<{ childId: string }>()
const t = useT()

const saved = ref<Record<QuickSlot, string | null>>({ 1: null, 2: null, 3: null, 4: null })
const draft = ref<Record<QuickSlot, string>>({ 1: '', 2: '', 3: '', 4: '' })
const status = ref<'loading' | 'ready' | 'error'>('loading')
// Enfant dont les textes sont en cours d'enregistrement : un seul enregistrement à la fois,
// même si l'on change d'enfant puis revient.
const savingFor = ref<string | null>(null)
const busy = computed(() => savingFor.value !== null)
const error = ref('')
const done = ref(false)

const defaultText = (slot: QuickSlot) => t.value.child.quick.texts[slot - 1]
const clean = (v: string) => v.trim()
// Ce qui serait enregistré : null (texte par défaut, traduit sur le téléphone) quand le champ est vide.
const target = (slot: QuickSlot): string | null => clean(draft.value[slot]) || null
const changed = computed(() => QUICK_SLOTS.filter((s) => target(s) !== saved.value[s]))
const tooLong = (slot: QuickSlot) => textLength(draft.value[slot]) > QUICK_TEXT_MAX
const invalid = computed(() => QUICK_SLOTS.some(tooLong))

function apply(list: MessageTemplate[]) {
  for (const { slot, text } of list) { saved.value[slot] = text; draft.value[slot] = text ?? '' }
}

let loadId = 0
async function load(childId: string) {
  const id = ++loadId
  status.value = 'loading'
  error.value = ''
  done.value = false
  try {
    const list = await getTemplates(childId)
    if (id !== loadId) return
    apply(list)
    status.value = 'ready'
  } catch (e) {
    if (id !== loadId) return
    error.value = errorText(e, t.value)
    status.value = 'error'
  }
}
watch(() => props.childId, (id) => { void load(id) }, { immediate: true })

async function save() {
  if (busy.value || !changed.value.length || invalid.value) return
  const childId = props.childId
  const todo = changed.value.map((slot) => ({ slot, text: target(slot) }))
  savingFor.value = childId
  error.value = ''
  done.value = false
  try {
    // Un emplacement à la fois, jusqu'au bout même si l'on change d'enfant : ce qui est
    // enregistré reste acquis si un envoi échoue.
    for (const { slot, text } of todo) await putTemplate(childId, slot, text)
    // Relu après coup : un chargement lancé pendant l'enregistrement (aller-retour entre
    // enfants) a pu lire l'état d'avant ; celui-ci le remplace.
    if (childId === props.childId) { await load(childId); if (childId === props.childId) done.value = true }
  } catch (e) {
    if (childId === props.childId) { error.value = errorText(e, t.value); void load(childId) }
  } finally {
    savingFor.value = null
  }
}
function reset(slot: QuickSlot) {
  draft.value[slot] = ''
  done.value = false
}
</script>

<template>
  <section id="messages-rapides" class="card templates" tabindex="-1">
    <h2>{{ t.templates.title }}</h2>
    <p class="hint">{{ t.templates.hint }}</p>
    <div v-if="status === 'error'" class="error" role="alert">
      <p>{{ t.templates.loadError }} {{ error }}</p>
      <button class="btn btn-ghost" type="button" @click="load(childId)">{{ t.errors.retry }}</button>
    </div>
    <form v-else :aria-busy="status === 'loading'" :class="{ refreshing: status === 'loading' }" @submit.prevent="save">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <ul class="slots">
        <li v-for="slot in QUICK_SLOTS" :key="slot" class="slot">
          <span class="icon" :style="{ background: QUICK_TINT[slot] }"><QuickIcon :kind="slot" :size="32" /></span>
          <div class="field">
            <label :for="`template-${slot}`">{{ t.templates.label(slot) }}</label>
            <template v-if="canManage()">
              <input
                :id="`template-${slot}`" v-model="draft[slot]" class="input" type="text"
                :placeholder="defaultText(slot)" autocomplete="off" :disabled="busy || status === 'loading'"
                :aria-invalid="tooLong(slot)" :aria-describedby="tooLong(slot) ? `template-${slot}-error` : undefined"
              />
              <p v-if="tooLong(slot)" :id="`template-${slot}-error`" class="field-error">{{ t.templates.invalid }}</p>
            </template>
            <p v-else :id="`template-${slot}`" class="readonly">{{ saved[slot] ?? defaultText(slot) }}</p>
          </div>
          <button
            v-if="canManage() && clean(draft[slot])" type="button" class="reset" :disabled="busy"
            @click="reset(slot)"
          >{{ t.templates.reset }}</button>
        </li>
      </ul>
      <p v-if="done" class="saved" role="status">{{ t.templates.saved }}</p>
      <button v-if="canManage()" class="btn" type="submit" :disabled="busy || !changed.length || invalid">{{ t.templates.save }}</button>
    </form>
  </section>
</template>

<style scoped>
/* Même écart entre cartes que « Code parent ». */
.templates {
  margin-top: 16px;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
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
.slots {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.slot {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
  padding: 10px 0;
}
.slot + .slot {
  border-top: 1px solid var(--border);
}
.icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
}
.field {
  flex: 1 1 180px;
  min-width: 0;
  margin: 0;
}
.readonly {
  margin: 4px 0 0;
  font-weight: 700;
}
.reset {
  flex: 1 0 100%;
  /* Aligné sous le champ : icône (48) + écart (12). */
  margin-left: 60px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-weight: 800;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}
.reset:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.field-error {
  margin: 4px 0 0;
  color: var(--danger);
  font-weight: 700;
}
.saved {
  font-weight: 700;
}
</style>
