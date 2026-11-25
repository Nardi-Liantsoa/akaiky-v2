<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
import { ref, watch } from 'vue'
import { createFamily } from '../../api/families'
import { ApiError } from '../../api/http'
import { useT } from '../../composables/useT'
import { FAMILY_NAME_MAX, familyNameValid } from '../../lib/familyName'
import { focusFirstInvalid, length } from '../../lib/formErrors'
import { errorText } from '../../lib/errors'
import { loadFamily } from '../../store/family'
import { takeNotice } from '../../store/notice'
import AppButton from '../ui/AppButton.vue'
import FormField from '../ui/FormField.vue'

const t = useT()
const name = ref('')
const busy = ref(false)
const error = ref('')
// Erreur du champ, montrée à l'envoi seulement (NAR-222) ; effacée dès que la saisie redevient valable.
const nameError = ref('')
const form = ref<HTMLFormElement | null>(null)
watch(name, (v) => { if (nameError.value && familyNameValid(v)) nameError.value = '' })
// Arrivée ici juste après la suppression de la famille : on le confirme.
const deleted = takeNotice('familyDeleted')

async function submit() {
  if (busy.value) return
  if (!familyNameValid(name.value)) {
    nameError.value = length(name.value) ? t.value.forms.tooLong(FAMILY_NAME_MAX) : t.value.forms.familyName
    await focusFirstInvalid(form.value)
    return
  }
  busy.value = true
  error.value = ''
  try {
    await createFamily(name.value.trim())
    await loadFamily(true)
  } catch (e) {
    // Déjà une famille (autre onglet, double envoi) : on l'affiche.
    if (e instanceof ApiError && e.code === 'family_exists') await loadFamily(true)
    else error.value = errorText(e, t.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="create">
    <p v-if="deleted" class="notice" role="status">{{ t.deletion.familyDeleted }}</p>
    <h1>{{ t.family.createTitle }}</h1>
    <p class="lead">{{ t.family.createLead }}</p>
    <form ref="form" class="card" novalidate @submit.prevent="submit">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <FormField id="family-name" :label="t.family.nameLabel" :error="nameError" v-slot="{ control }">
        <input v-bind="control" v-model="name" class="input" required :placeholder="t.family.namePlaceholder" autocomplete="off" data-selectable />
      </FormField>
      <AppButton block type="submit" :disabled="busy"><AppIcon name="plus" :size="20" />{{ t.family.create }}</AppButton>
    </form>
  </section>
</template>

<style scoped>
.notice {
  padding: 11px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  margin: 8px 0 16px;
}
h1 {
  margin: 8px 0 8px;
}
.lead {
  margin: 0 0 20px;
  color: var(--text-soft);
}
</style>
