<script setup lang="ts">
import { computed, ref } from 'vue'
import { locale, useT } from '../../composables/useT'
import { formatLongDate } from '../../lib/format'
import { clampDay, dayBounds, dayName, shiftDay } from '../../lib/journalDay'
import AppIcon from '../ui/AppIcon.vue'

// Sélecteur de jour du journal (NAR-233, design créé d'après le sélecteur d'enfant) :
// ‹ jour précédent · [calendrier] jour affiché · jour suivant ›. 90 jours au plus, jamais demain.
// Le bouton du milieu ouvre le calendrier natif du champ date (showPicker). Sans showPicker
// (WebView Android < 99), le champ, invisible, couvre le bouton : le toucher l'ouvre.
// todayKey : aujourd'hui, tenu à jour par l'écran (passage de minuit compris).
const props = defineProps<{ modelValue: string, todayKey: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const t = useT()
const bounds = computed(() => dayBounds(props.todayKey))
const label = computed(() => dayName(props.modelValue, props.todayKey, t.value.parent.log, (d) => formatLongDate(d, locale.value)))
const canShowPicker = typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype
const field = ref<HTMLInputElement | null>(null)
function go(days: number) {
  const next = clampDay(shiftDay(props.modelValue, days), props.todayKey)
  if (next) emit('update:modelValue', next)
}
function pick(e: Event) {
  if (!(e.target instanceof HTMLInputElement)) return
  const day = clampDay(e.target.value, props.todayKey)
  if (day) emit('update:modelValue', day)
  // Champ vidé ou hors bornes : il reprend le jour affiché (Vue ne le réécrit pas, rien n'a changé).
  else e.target.value = props.modelValue
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
      ref="field" class="native" :class="{ cover: !canShowPicker }" type="date" :value="modelValue" :min="bounds.min" :max="bounds.max"
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
/* Sans showPicker : le champ couvre le bouton du milieu (entre les deux flèches). */
.native.cover {
  left: calc(var(--tap) + 8px);
  right: calc(var(--tap) + 8px);
  top: 0;
  width: auto;
  height: 100%;
  pointer-events: auto;
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
