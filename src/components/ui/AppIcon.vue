<script setup lang="ts">
import { computed } from 'vue'
import { ICONS, type IconDef, type IconName } from './icons'

// Icône du jeu commun (NAR-182). Décorative par défaut (aria-hidden) ; avec `label`,
// elle devient une image nommée pour les lecteurs d'écran. `size` fixe la largeur, la
// hauteur suit le cadre de l'icône. Emplacement : formes en plus (niveau de batterie).
const props = withDefaults(defineProps<{ name: IconName, size?: number, label?: string }>(), { size: 24, label: undefined })

const icon = computed<IconDef>(() => ICONS[props.name])
const viewBox = computed(() => icon.value.viewBox ?? '0 0 24 24')
const height = computed(() => {
  const [, , w, h] = viewBox.value.split(' ').map(Number)
  return Math.round((props.size * h) / w * 100) / 100
})
</script>

<template>
  <svg
    :viewBox="viewBox" :width="size" :height="height"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    v-bind="icon.svg"
    :role="label ? 'img' : undefined" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'"
  >
    <template v-for="(s, i) in icon.shapes" :key="i">
      <path v-if="s.tag === 'path'" v-bind="s.attrs" />
      <circle v-else-if="s.tag === 'circle'" v-bind="s.attrs" />
      <rect v-else v-bind="s.attrs" />
    </template>
    <slot />
  </svg>
</template>
