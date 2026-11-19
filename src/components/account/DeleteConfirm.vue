<script setup lang="ts">
import { useConfirm } from '../../composables/useConfirm'
import AppButton from '../ui/AppButton.vue'
import ConfirmSheet from '../ui/ConfirmSheet.vue'

// Carte de suppression définitive : titre, explication et bouton sur la page ; la
// confirmation passe par la feuille commune (NAR-184) avec le mot de passe du compte.
// Le parent fait l'appel et renvoie l'erreur à afficher dans la feuille ; il ferme la
// feuille en quittant l'écran (succès).
defineProps<{ id: string, title: string, lead: string, items?: string[], action: string, confirm: string, busy: boolean, error: string }>()
const emit = defineEmits<{ confirm: [password: string], cancel: [] }>()
const { target, opener, ask, close } = useConfirm<true>()

function cancel() {
  close()
  emit('cancel')
}
</script>

<template>
  <section class="card danger-zone" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`">{{ title }}</h2>
    <p class="lead">{{ lead }}</p>
    <AppButton variant="danger" @click="ask(true, $event)">{{ action }}</AppButton>
    <ConfirmSheet
      v-if="target" :id="id" :title="title" :items="items" :confirm="confirm" :busy="busy" :error="error"
      :opener="opener" require-password @close="cancel" @confirm="emit('confirm', $event)"
    >
      <slot />
    </ConfirmSheet>
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
.lead {
  margin: 0 0 12px;
  color: var(--text-soft);
}
</style>
