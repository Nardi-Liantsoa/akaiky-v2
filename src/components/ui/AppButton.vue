<script setup lang="ts">
import { computed } from 'vue'

// Bouton commun (NAR-182) : classes globales de src/style.css, au moins --tap (48 px)
// de haut quelle que soit la variante, anneau de focus clavier, type « button » par
// défaut (jamais un envoi de formulaire involontaire). Attributs et écouteurs passent
// tels quels au <button>.
export type AppButtonVariant = 'primary' | 'ghost' | 'danger' | 'link' | 'danger-link'

const props = withDefaults(defineProps<{
  variant?: AppButtonVariant
  type?: 'button' | 'submit' | 'reset'
  small?: boolean
  block?: boolean
  disabled?: boolean
}>(), { variant: 'primary', type: 'button', small: false, block: false, disabled: false })

const classes = computed(() => [
  'btn',
  props.variant !== 'primary' && `btn-${props.variant}`,
  props.small && 'btn-small',
  props.block && 'btn-block'
].filter(Boolean))
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled"><slot /></button>
</template>
