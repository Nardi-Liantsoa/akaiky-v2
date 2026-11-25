<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
import { useConfirm } from '../../composables/useConfirm'
import AppButton from '../ui/AppButton.vue'
import ConfirmSheet from '../ui/ConfirmSheet.vue'
import SectionCard from '../ui/SectionCard.vue'

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
  <SectionCard class="danger-zone" :title="title" :help="lead">
    <AppButton variant="danger" @click="ask(true, $event)"><AppIcon name="trash" :size="20" />{{ action }}</AppButton>
    <ConfirmSheet
      v-if="target" :id="id" :title="title" :items="items" :confirm="confirm" :busy="busy" :error="error"
      :opener="opener" require-password @close="cancel" @confirm="emit('confirm', $event)"
    >
      <slot />
    </ConfirmSheet>
  </SectionCard>
</template>

<style scoped>
.danger-zone {
  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
}
.danger-zone :deep(.section-title) {
  color: var(--danger);
}
</style>
