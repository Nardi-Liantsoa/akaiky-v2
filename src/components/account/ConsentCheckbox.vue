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
  <div class="consent" :class="{ invalid: !!error }">
    <label :for="id" class="row">
      <input :id="id" v-model="checked" type="checkbox" aria-required="true"
        :aria-invalid="error ? 'true' : undefined" :aria-describedby="error ? `${id}-error` : undefined" />
      <span>{{ label }}</span>
    </label>
    <p v-if="error" :id="`${id}-error`" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
/* Encadré (maquette 07, NAR-222) : case de 24 px, texte en taille normale, toute la ligne
 * cliquable ; bord rouge quand l'envoi a été tenté sans la case. */
.consent {
  margin-bottom: 16px;
}
.row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: var(--tap);
  padding: 12px 14px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  font-size: var(--fs-body);
  line-height: 1.45;
  color: var(--text);
  cursor: pointer;
}
.invalid .row {
  border-color: var(--danger);
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
  margin: 6px 0 0;
}
</style>
