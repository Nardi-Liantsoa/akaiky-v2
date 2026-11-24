<script setup lang="ts">
import { useT } from '../../composables/useT'
import { AVATAR_COLORS, type AvatarColor } from '../../lib/avatar'
import ChildAvatar from './ChildAvatar.vue'

// Choix de la couleur d'avatar, commun aux formulaires enfant et contact (NAR-207) :
// cinq pastilles sur une ligne dès 360 px de large, cibles d'au moins 48 px.
// name : nom du groupe de boutons radio ; avatar : nom affiché dans les pastilles
// (vide : pastille unie, sans « ? »).
defineProps<{ name: string, legend: string, avatar: string }>()
const color = defineModel<AvatarColor | null>({ required: true })
const t = useT()
</script>

<template>
  <fieldset class="field colors">
    <legend>{{ legend }}</legend>
    <label v-for="c in AVATAR_COLORS" :key="c" class="swatch">
      <input v-model="color" type="radio" :name="name" :value="c" :aria-label="t.children.colors[c]" />
      <ChildAvatar :name="avatar" :color="c" :size="40" />
    </label>
  </fieldset>
</template>

<style scoped>
.colors {
  border: none;
  padding: 0;
  margin: 0 0 20px;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
}
.colors legend {
  width: 100%;
  margin-bottom: 8px;
}
/* 40 + 2 × 2 + 2 × 3 = 50 px par pastille ; cinq avec leurs écarts : 274 px (formulaire : 280 px à 360 px de large). */
.swatch {
  position: relative;
  display: inline-flex;
  padding: 2px;
  border: 3px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.swatch:has(input:checked) {
  border-color: var(--ink);
}
.swatch:has(input:focus-visible) {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.swatch input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
</style>
