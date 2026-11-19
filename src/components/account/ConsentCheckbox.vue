<script setup lang="ts">
// Case de consentement obligatoire (NAR-178) : toute la ligne est cliquable (≥ 44 px),
// l'erreur s'affiche sous la case quand le formulaire est envoyé sans elle. Pas d'attribut
// `required` : le message vient de l'application, dans la langue choisie. L'erreur
// (v-model:error) s'efface dès que la case est cochée : plus d'aria-invalid ni d'alerte.
import { watch } from 'vue'

defineProps<{ id: string, label: string }>()
const checked = defineModel<boolean>({ required: true })
const error = defineModel<string>('error', { default: '' })
watch(checked, (on) => { if (on) error.value = '' })
</script>

<template>
  <div class="consent">
    <label :for="id" class="row">
      <input :id="id" v-model="checked" type="checkbox" aria-required="true"
        :aria-invalid="error ? 'true' : undefined" :aria-describedby="error ? `${id}-error` : undefined" />
      <span>{{ label }}</span>
    </label>
    <p v-if="error" :id="`${id}-error`" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.consent {
  margin-bottom: 16px;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 44px;
  padding: 10px 0;
  font-size: 0.9rem;
  line-height: 1.4;
  color: var(--text-soft);
  cursor: pointer;
}
input {
  flex: none;
  width: 24px;
  height: 24px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.error {
  margin: 4px 0 0;
}
</style>
