<script setup lang="ts">
import { computed, useId } from 'vue'

// Champ de formulaire commun (NAR-186) : libellé relié au champ (for/id), aide et
// erreur reliées par aria-describedby, aria-invalid quand une erreur est montrée.
// Le champ est fourni par l'emplacement, qui reçoit `control` à poser dessus
// (v-bind="control") : id, aria-describedby, aria-invalid. Sans id fourni, un id est
// généré.
export interface FieldControl {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: 'true'
}

const props = withDefaults(defineProps<{ label: string, id?: string, help?: string, error?: string }>(), { id: '', help: '', error: '' })
defineSlots<{ default(props: { control: FieldControl }): unknown }>()
const generated = useId()
const fieldId = computed(() => props.id || generated)
const helpId = computed(() => `${fieldId.value}-help`)
const errorId = computed(() => `${fieldId.value}-error`)
const control = computed<FieldControl>(() => {
  const described = [props.help && helpId.value, props.error && errorId.value].filter(Boolean).join(' ')
  return {
    id: fieldId.value,
    ...(described ? { 'aria-describedby': described } : {}),
    ...(props.error ? { 'aria-invalid': 'true' as const } : {})
  }
})
</script>

<template>
  <div class="field" :class="{ invalid: !!error }">
    <label :for="fieldId">{{ label }}</label>
    <slot :control="control" />
    <p v-if="help" :id="helpId" class="field-help">{{ help }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.field-help,
.field-error {
  margin: 0;
  font-size: var(--fs-small);
}
.field-help {
  color: var(--text-soft);
}
.field-error {
  color: var(--danger);
  font-weight: 700;
}
</style>
