<script setup lang="ts">
import { computed, ref } from 'vue'
import { locale, useT } from '../../composables/useT'
import { formatLongDate } from '../../lib/format'
import { clampDay, dayBounds, dayDate, shiftDay } from '../../lib/journalDay'
import AppIcon from '../ui/AppIcon.vue'

// Sélecteur de jour du journal (NAR-233, design créé d'après le sélecteur d'enfant) :
// ‹ jour précédent · [calendrier] jour affiché · jour suivant ›. 90 jours au plus, jamais demain.
// Le bouton du milieu ouvre le calendrier natif du champ date (showPicker), qui reste
// utilisable au clavier et par les lecteurs d'écran.
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const t = useT()
const bounds = computed(() => dayBounds())
const label = computed(() => {
  const { max } = bounds.value
  if (props.modelValue === max) return t.value.parent.log.today
  if (props.modelValue === shiftDay(max, -1)) return t.value.parent.log.yesterday
  return formatLongDate(dayDate(props.modelValue), locale.value)
})
const field = ref<HTMLInputElement | null>(null)
function go(days: number) {
  const next = clampDay(shiftDay(props.modelValue, days))
  if (next) emit('update:modelValue', next)
}
function pick(e: Event) {
  const raw = e.target instanceof HTMLInputElement ? e.target.value : ''
  const day = clampDay(raw)
  if (day) emit('update:modelValue', day)
}
function open() {
  const input = field.value
  if (!input) return
  try { input.showPicker() } catch { input.focus() }
}
</script>

<template>
  <div class="day-picker" role="group" :aria-label="t.parent.log.dayPicker.label">
    <button type="button" class="step" :aria-label="t.parent.log.dayPicker.prev" :disabled="modelValue <= bounds.min" @click="go(-1)">
      <AppIcon name="chevron-left" :size="22" />
    </button>
    <button type="button" class="current" :aria-label="t.parent.log.dayPicker.pick(label)" @click="open">
      <AppIcon name="calendar" :size="20" />
      <span>{{ label }}</span>
    </button>
    <input
      ref="field" class="native" type="date" :value="modelValue" :min="bounds.min" :max="bounds.max"
      :aria-label="t.parent.log.dayPicker.field" tabindex="-1" @change="pick"
    >
    <button type="button" class="step" :aria-label="t.parent.log.dayPicker.next" :disabled="modelValue >= bounds.max" @click="go(1)">
      <AppIcon name="chevron-right" :size="22" />
    </button>
  </div>
</template>

<style scoped>
.day-picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.step,
.current {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  border: 1.5px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.step {
  flex: none;
  width: var(--tap);
}
.step:disabled {
  opacity: 0.4;
  cursor: default;
}
.current {
  flex: 1;
  gap: 8px;
  padding: 0 16px;
}
/* Champ natif sous le bouton du milieu : porte le calendrier, invisible. */
.native {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.step:focus-visible,
.current:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
@media (min-width: 560px) {
  .current {
    flex: 0 1 auto;
    min-width: 240px;
  }
}
</style>
