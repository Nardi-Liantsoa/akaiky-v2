<script setup lang="ts">
import { ref } from 'vue'
import PasswordInput from '../PasswordInput.vue'
import { useT } from '../../composables/useT'
import AppButton from '../ui/AppButton.vue'

// Carte de suppression définitive : bouton, puis confirmation en place avec le
// mot de passe du compte. Le parent fait l'appel et renvoie l'erreur à afficher.
const props = defineProps<{ id: string, title: string, lead: string, items?: string[], action: string, confirm: string, busy: boolean, error: string }>()
const emit = defineEmits<{ confirm: [password: string], cancel: [] }>()
const t = useT()
const open = ref(false)
const password = ref('')

function cancel() {
  open.value = false
  password.value = ''
  emit('cancel')
}
function submit() {
  if (props.busy || !password.value) return
  emit('confirm', password.value)
}
</script>

<template>
  <section class="card danger-zone" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`">{{ title }}</h2>
    <p class="lead">{{ lead }}</p>
    <AppButton v-if="!open" variant="danger" @click="open = true">{{ action }}</AppButton>
    <form v-else @submit.prevent="submit">
      <ul v-if="items?.length" class="items">
        <li v-for="item in items" :key="item">{{ item }}</li>
      </ul>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <slot />
      <p class="hint">{{ t.deletion.passwordLead }}</p>
      <div class="field">
        <label :for="`${id}-password`">{{ t.deletion.passwordLabel }}</label>
        <PasswordInput :id="`${id}-password`" v-model="password" autocomplete="current-password" />
      </div>
      <div class="actions">
        <AppButton variant="danger" type="submit" :disabled="busy || !password">{{ confirm }}</AppButton>
        <AppButton variant="ghost" :disabled="busy" @click="cancel">{{ t.deletion.cancel }}</AppButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
.danger-zone {
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
}
h2 {
  margin: 0 0 8px;
  color: var(--danger);
}
.lead,
.hint {
  margin: 0 0 12px;
  color: var(--text-soft);
}
.items {
  margin: 0 0 16px;
  padding-left: 20px;
}
.items li {
  margin-bottom: 4px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
