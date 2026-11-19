<script setup lang="ts">
import { useId } from 'vue'

// Interrupteur commun (NAR-186) : <button role="switch"> avec aria-checked, nommé par
// son libellé (visible, ou réservé aux lecteurs d'écran avec hideLabel), décrit par
// description (aria-describedby). Zone tactile ≥ --tap. v-model contrôlé : la valeur
// affichée est toujours celle du parent (pas d'affichage anticipé d'un envoi au serveur).
// Attributs et écouteurs passent au <button>.
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  modelValue: boolean
  label: string
  description?: string
  hideLabel?: boolean
  disabled?: boolean
}>(), { description: '', hideLabel: false, disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const descriptionId = useId()

function flip() {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <div class="toggle-switch" :class="{ compact: hideLabel }">
    <button
      v-bind="$attrs" type="button" role="switch" class="switch" :aria-checked="modelValue"
      :aria-describedby="description ? descriptionId : undefined" :disabled="disabled" @click="flip"
    >
      <span class="switch-label" :class="{ 'visually-hidden': hideLabel }">{{ label }}</span>
      <span class="track" aria-hidden="true"><span class="thumb" /></span>
    </button>
    <p v-if="description" :id="descriptionId" class="help switch-description">{{ description }}</p>
  </div>
</template>

<style scoped>
.compact {
  flex: none;
}
.switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: 100%;
  min-width: var(--tap);
  min-height: var(--tap);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.compact .switch {
  justify-content: center;
}
.switch:disabled {
  cursor: default;
}
.track {
  position: relative;
  flex: none;
  width: 52px;
  height: 32px;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
}
.switch[aria-checked='true'] .track {
  background: var(--accent);
}
/* Désactivé : le dessin s'estompe, le libellé reste lisible. */
.switch:disabled .track {
  opacity: 0.55;
}
.thumb {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform 0.15s;
}
.switch[aria-checked='true'] .thumb {
  transform: translateX(20px);
}
.switch-description {
  margin: var(--space-1) 0 0;
}
@media (prefers-reduced-motion: reduce) {
  .thumb {
    transition: none;
  }
}
</style>
