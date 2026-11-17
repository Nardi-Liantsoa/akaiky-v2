<script setup lang="ts">
import { ref } from 'vue'
import { createFamily } from '../../api/families'
import { ApiError } from '../../api/http'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { loadFamily } from '../../store/family'

const t = useT()
const name = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  if (busy.value || !name.value.trim()) return
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
    <h1>{{ t.family.createTitle }}</h1>
    <p class="lead">{{ t.family.createLead }}</p>
    <form class="card" @submit.prevent="submit">
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="field">
        <label for="family-name">{{ t.family.nameLabel }}</label>
        <input id="family-name" v-model="name" class="input" maxlength="80" required :placeholder="t.family.namePlaceholder" autocomplete="off" data-selectable />
      </div>
      <button class="btn" type="submit" :disabled="busy || !name.trim()">{{ t.family.create }}</button>
    </form>
  </section>
</template>

<style scoped>
h1 {
  font-size: 2rem;
  margin: 8px 0 8px;
}
.lead {
  margin: 0 0 20px;
  color: var(--text-soft);
}
.btn {
  width: 100%;
}
</style>
