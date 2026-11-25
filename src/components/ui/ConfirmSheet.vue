<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'
import { nextTick, onMounted, ref, watch } from 'vue'
import PasswordInput from '../PasswordInput.vue'
import ChildSheet from '../parent/ChildSheet.vue'
import { useT } from '../../composables/useT'
import AppButton from './AppButton.vue'

// Confirmation unique de toute action destructive (NAR-184) : feuille du bas de
// ChildSheet (Teleport, pile des feuilles : Échap, retour Android, fond ; focus gardé,
// rendu au bouton d'origine à la fermeture). Titre, conséquences en liste, bouton
// danger et « Annuler » ; mot de passe facultatif (requirePassword), erreur dans la
// feuille. Le parent fait l'appel seulement à l'événement confirm, et ferme la feuille.
// Pendant l'appel (busy), rien ne la ferme : l'action ne s'annulerait pas.
const props = withDefaults(defineProps<{
  title: string
  confirm: string
  items?: string[]
  lead?: string
  busy?: boolean
  error?: string
  requirePassword?: boolean
  opener?: HTMLElement | null
  id?: string
  // Icône du bouton de confirmation (NAR-229, « Retirer ce téléphone ») ; avec elle, « Annuler »
  // prend aussi la sienne. Sans elle, la feuille garde ses boutons texte.
  confirmIcon?: IconName
}>(), { items: () => [], lead: '', busy: false, error: '', requirePassword: false, opener: null, id: 'confirm-sheet', confirmIcon: undefined })
const emit = defineEmits<{ confirm: [password: string], close: [] }>()
const t = useT()
const password = ref('')
const field = ref<HTMLElement | null>(null)

function close() { if (!props.busy) emit('close') }
function submit() {
  if (props.busy || (props.requirePassword && !password.value)) return
  emit('confirm', props.requirePassword ? password.value : '')
}
// Mot de passe demandé : le champ prend le focus (après celui de la feuille).
const focusField = () => { if (props.requirePassword) void nextTick(() => field.value?.querySelector('input')?.focus()) }
onMounted(focusField)
// Fin d'un envoi, feuille encore ouverte (échec) : le mot de passe saisi est effacé,
// jamais gardé pour un nouvel essai ; le champ reprend le focus.
watch(() => props.busy, (now, before) => {
  if (before && !now && password.value) { password.value = ''; focusField() }
})
</script>

<template>
  <ChildSheet :title="title" :opener="opener" alert @close="close">
    <form :id="`${id}-form`" class="confirm" :aria-busy="busy" @submit.prevent="submit">
      <p v-if="lead" class="lead">{{ lead }}</p>
      <ul v-if="items.length" class="items">
        <li v-for="item in items" :key="item">{{ item }}</li>
      </ul>
      <slot />
      <template v-if="requirePassword">
        <p class="lead">{{ t.deletion.passwordLead }}</p>
        <div ref="field" class="field">
          <label :for="`${id}-password`">{{ t.deletion.passwordLabel }}</label>
          <PasswordInput :id="`${id}-password`" v-model="password" autocomplete="current-password" />
        </div>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
    <template #actions>
      <div class="actions">
        <AppButton variant="danger" type="submit" :form="`${id}-form`" block :disabled="busy || (requirePassword && !password)">
          <AppIcon v-if="confirmIcon && !busy" :name="confirmIcon" :size="20" />{{ busy ? t.confirmSheet.busy : confirm }}
        </AppButton>
        <AppButton variant="ghost" block :disabled="busy" @click="close"><AppIcon v-if="confirmIcon" name="cross" :size="20" />{{ t.confirmSheet.cancel }}</AppButton>
      </div>
    </template>
  </ChildSheet>
</template>

<style scoped>
.lead {
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
.error {
  margin: 0 0 12px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
</style>
