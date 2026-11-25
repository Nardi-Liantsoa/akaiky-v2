<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError } from '../../api/http'
import { remoteUnlock, setParentCode, type Child } from '../../api/children'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { focusFirstInvalid } from '../../lib/formErrors'
import { formatClock, formatDay } from '../../lib/format'
import { parentCodeProblem } from '../../lib/parentCode'
import { children, upsertChild } from '../../store/children'
import { canManage } from '../../store/family'
import AppButton from '../ui/AppButton.vue'
import FormField from '../ui/FormField.vue'
import SectionCard from '../ui/SectionCard.vue'

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
// Erreurs sous chaque champ à l'envoi (NAR-222) : code refusé sous le code, différence sous la confirmation.
const codeError = ref('')
const confirmError = ref('')
const form = ref<HTMLFormElement | null>(null)
watch(code, () => { codeError.value = '' })
watch(confirmation, () => { confirmError.value = '' })

// Autre enfant choisi : formulaire refermé, rien de saisi ne passe d'un enfant à l'autre.
watch(() => props.child.id, () => { close(); saved.value = false; busy.value = false; unlockBusy.value = false; unlockError.value = '' })

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
  codeError.value = ''
  confirmError.value = ''
}

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 6)

function problemText(problem: string | null | undefined): string | null {
  if (problem === 'invalid_parent_code') return t.value.parentCode.invalid
  if (problem === 'weak_parent_code') return t.value.parentCode.weak
  return null
}

async function save() {
  if (busy.value) return
  error.value = ''
  codeError.value = problemText(parentCodeProblem(code.value)) ?? ''
  confirmError.value = !codeError.value && code.value !== confirmation.value ? t.value.parentCode.mismatch : ''
  if (codeError.value || confirmError.value) { await focusFirstInvalid(form.value); return }
  const child = props.child
  busy.value = true
  error.value = ''
  try {
    const res = await setParentCode(child.id, code.value)
    // Appliqué à la liste des enfants (s'il y est encore) : « défini le … » suit sans relecture.
    const current = children.items.find((c) => c.id === child.id)
    if (current) upsertChild({ ...current, parentCodeSetAt: res.parentCodeSetAt, remoteUnlockUntil: null, parentCodeResetRequestedAt: null })
    if (child.id === props.child.id) { close(); saved.value = true }
  } catch (e) {
    if (child.id === props.child.id) error.value = (e instanceof ApiError && problemText(e.code)) || errorText(e, t.value)
  } finally {
    // Autre enfant choisi entre-temps : son formulaire est déjà libre.
    if (child.id === props.child.id) busy.value = false
  }
}

// Déverrouillage à distance (NAR-168, maquette écran 8) : 15 minutes, appliqué par le
// téléphone à son relevé suivant (30 s s'il est connecté et à l'écran).
const unlockBusy = ref(false)
const unlockError = ref('')
// Heure relue toutes les 30 s : l'état « demandé jusqu'à … » s'efface seul à l'échéance.
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 30_000)
onBeforeUnmount(() => clearInterval(clock))
const unlockedUntil = computed(() => {
  const until = props.child.remoteUnlockUntil ? Date.parse(props.child.remoteUnlockUntil) : NaN
  return Number.isNaN(until) || until <= now.value ? null : new Date(until)
})
async function unlockNow() {
  if (unlockBusy.value) return
  const child = props.child
  unlockBusy.value = true
  unlockError.value = ''
  try {
    const res = await remoteUnlock(child.id)
    const current = children.items.find((c) => c.id === child.id)
    if (current) upsertChild({ ...current, remoteUnlockUntil: res.remoteUnlockUntil })
  } catch (e) {
    if (child.id !== props.child.id) return
    unlockError.value = e instanceof ApiError && e.code === 'no_parent_code' ? t.value.parentCode.unlockNoCode : errorText(e, t.value)
  } finally {
    if (child.id === props.child.id) unlockBusy.value = false
  }
}
</script>

<template>
  <SectionCard id="code-parent" class="parent-code" tabindex="-1" :title="t.parentCode.title" :help="t.parentCode.hint">
    <!-- Nouveau code demandé par l'équipe (NAR-200) : aux gestionnaires, qui seuls peuvent le choisir. -->
    <p v-if="canManage() && child.parentCodeResetRequestedAt" class="reset-requested" role="status">
      {{ t.parentCode.resetRequested(formatDay(child.parentCodeResetRequestedAt, locale)) }}
    </p>
    <p class="state" :class="{ missing: !child.parentCodeSetAt }">
      {{ child.parentCodeSetAt ? t.parentCode.setOn(formatDay(child.parentCodeSetAt, locale)) : t.parentCode.notSet }}
    </p>
    <p v-if="saved" class="saved" role="status">{{ t.parentCode.saved }}</p>
    <template v-if="canManage()">
      <AppButton v-if="!editing" variant="ghost" @click="open">
        {{ child.parentCodeSetAt ? t.parentCode.change : t.parentCode.set }}
      </AppButton>
      <form v-else ref="form" novalidate @submit.prevent="save">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <FormField id="parent-code" :label="t.parentCode.code" :error="codeError" v-slot="{ control }">
          <input
            v-bind="control" class="input code" type="password" inputmode="numeric" autocomplete="off"
            :value="code" required @input="code = digitsOnly(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = code"
          />
        </FormField>
        <FormField id="parent-code-confirm" :label="t.parentCode.confirm" :error="confirmError" v-slot="{ control }">
          <input
            v-bind="control" class="input code" type="password" inputmode="numeric" autocomplete="off"
            :value="confirmation" required @input="confirmation = digitsOnly(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = confirmation"
          />
        </FormField>
        <div class="actions">
          <AppButton type="submit" :disabled="busy">{{ t.parentCode.save }}</AppButton>
          <AppButton variant="ghost" :disabled="busy" @click="close">{{ t.parentCode.cancel }}</AppButton>
        </div>
      </form>
    </template>
    <div v-if="child.parentCodeSetAt" class="remote">
      <p v-if="unlockedUntil" class="state" role="status">{{ t.parentCode.unlockedUntil(formatClock(unlockedUntil)) }}</p>
      <p v-if="unlockError" class="error" role="alert">{{ unlockError }}</p>
      <AppButton v-if="canManage() && !editing" :disabled="unlockBusy" @click="unlockNow">{{ t.parentCode.unlock }}</AppButton>
      <p v-if="canManage() && !editing" class="help unlock-help">{{ t.parentCode.unlockHint }}</p>
    </div>
  </SectionCard>
</template>

<style scoped>
.parent-code {
  margin-top: 16px;
}
.remote {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.unlock-help {
  margin-bottom: 0;
}
.state {
  margin: 0 0 12px;
  font-weight: 700;
}
.state.missing {
  color: var(--danger);
}
.reset-requested {
  margin: 0 0 12px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-weight: 700;
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
