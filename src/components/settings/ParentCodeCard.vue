<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '../../api/http'
import { setParentCode, type Child } from '../../api/children'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { formatDay } from '../../lib/format'
import { parentCodeProblem } from '../../lib/parentCode'
import { children, upsertChild } from '../../store/children'
import { canManage } from '../../store/family'

// Code parent de l'enfant (NAR-139). Le code ne revient jamais du serveur : la carte
// dit seulement s'il est défini et depuis quand. Un contact (member) ne voit que l'état.
const props = defineProps<{ child: Child }>()
const t = useT()
const editing = ref(false)
const code = ref('')
const confirmation = ref('')
const busy = ref(false)
const error = ref('')
const saved = ref(false)

// Autre enfant choisi : formulaire refermé, rien de saisi ne passe d'un enfant à l'autre.
watch(() => props.child.id, () => { close(); saved.value = false; busy.value = false })

function open() {
  editing.value = true
  saved.value = false
  error.value = ''
}
function close() {
  editing.value = false
  code.value = ''
  confirmation.value = ''
  error.value = ''
}

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 6)
const complete = computed(() => code.value.length === 6 && confirmation.value.length === 6)

function problemText(problem: string | null | undefined): string | null {
  if (problem === 'invalid_parent_code') return t.value.parentCode.invalid
  if (problem === 'weak_parent_code') return t.value.parentCode.weak
  return null
}

async function save() {
  if (busy.value) return
  const problem = problemText(parentCodeProblem(code.value))
  if (problem) { error.value = problem; return }
  if (code.value !== confirmation.value) { error.value = t.value.parentCode.mismatch; return }
  const child = props.child
  busy.value = true
  error.value = ''
  try {
    const res = await setParentCode(child.id, code.value)
    // Appliqué à la liste des enfants (s'il y est encore) : « défini le … » suit sans relecture.
    const current = children.items.find((c) => c.id === child.id)
    if (current) upsertChild({ ...current, parentCodeSetAt: res.parentCodeSetAt })
    if (child.id === props.child.id) { close(); saved.value = true }
  } catch (e) {
    if (child.id === props.child.id) error.value = (e instanceof ApiError && problemText(e.code)) || errorText(e, t.value)
  } finally {
    // Autre enfant choisi entre-temps : son formulaire est déjà libre.
    if (child.id === props.child.id) busy.value = false
  }
}
</script>

<template>
  <section class="card parent-code">
    <h2>{{ t.parentCode.title }}</h2>
    <p class="hint">{{ t.parentCode.hint }}</p>
    <p class="state" :class="{ missing: !child.parentCodeSetAt }">
      {{ child.parentCodeSetAt ? t.parentCode.setOn(formatDay(child.parentCodeSetAt, locale)) : t.parentCode.notSet }}
    </p>
    <p v-if="saved" class="saved" role="status">{{ t.parentCode.saved }}</p>
    <template v-if="canManage()">
      <button v-if="!editing" class="btn btn-ghost" type="button" @click="open">
        {{ child.parentCodeSetAt ? t.parentCode.change : t.parentCode.set }}
      </button>
      <form v-else @submit.prevent="save">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="field">
          <label for="parent-code">{{ t.parentCode.code }}</label>
          <input
            id="parent-code" class="input code" type="password" inputmode="numeric" autocomplete="off"
            :value="code" required @input="code = digitsOnly(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = code"
          />
        </div>
        <div class="field">
          <label for="parent-code-confirm">{{ t.parentCode.confirm }}</label>
          <input
            id="parent-code-confirm" class="input code" type="password" inputmode="numeric" autocomplete="off"
            :value="confirmation" required @input="confirmation = digitsOnly(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = confirmation"
          />
        </div>
        <div class="actions">
          <button class="btn" type="submit" :disabled="busy || !complete">{{ t.parentCode.save }}</button>
          <button class="btn btn-ghost" type="button" :disabled="busy" @click="close">{{ t.parentCode.cancel }}</button>
        </div>
      </form>
    </template>
  </section>
</template>

<style scoped>
.parent-code {
  margin-top: 16px;
}
h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
}
.hint {
  margin: 4px 0 8px;
  color: var(--text-soft);
}
.state {
  margin: 0 0 12px;
  font-weight: 700;
}
.state.missing {
  color: var(--danger);
}
.saved {
  margin: 0 0 12px;
  font-weight: 700;
}
.code {
  max-width: 12em;
  letter-spacing: 0.4em;
  font-variant-numeric: tabular-nums;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
