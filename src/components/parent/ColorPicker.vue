<script setup lang="ts">
import { useT } from '../../composables/useT'
import { AVATAR_COLORS, type AvatarColor } from '../../lib/avatar'
import AppIcon from '../ui/AppIcon.vue'
import ChildAvatar from './ChildAvatar.vue'

// Choix de la couleur d'avatar, commun aux formulaires enfant et contact (NAR-207, NAR-222) :
// vrais boutons radio (flèches du clavier, nom lu « Orange »…), nom écrit sous chaque
// pastille, coche sur la couleur choisie (pas seulement un contour), cibles ≥ --tap.
// name : nom du groupe de boutons radio ; avatar : nom affiché dans les pastilles
// (vide : pastille unie, sans « ? »).
defineProps<{ name: string, legend: string, avatar: string }>()
const color = defineModel<AvatarColor | null>({ required: true })
const t = useT()
</script>

<template>
  <fieldset class="field colors">
    <legend>{{ legend }}</legend>
    <div class="row">
      <label v-for="c in AVATAR_COLORS" :key="c" class="swatch">
        <input v-model="color" type="radio" :name="name" :value="c" />
        <span class="disc">
          <ChildAvatar :name="avatar" :color="c" :size="44" />
          <span v-if="color === c" class="tick" aria-hidden="true"><AppIcon name="check" :size="14" /></span>
        </span>
        <span class="label">{{ t.children.colors[c] }}</span>
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.colors {
  border: none;
  padding: 0;
  margin: 0 0 20px;
}
.colors legend {
  margin-bottom: 8px;
}
/* Cinq colonnes égales : tient dès 280 px de large (formulaire à 360 px d'écran). */
.row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}
.swatch {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: var(--tap);
  cursor: pointer;
}
.disc {
  position: relative;
  display: inline-flex;
  padding: 2px;
  border: 3px solid transparent;
  border-radius: 50%;
}
.swatch:has(input:checked) .disc {
  border-color: var(--ink);
}
.swatch:has(input:focus-visible) .disc {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
/* Coche sur fond --ink : lisible sur les cinq couleurs, jaune compris. */
.tick {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--ink);
  color: var(--on-color);
}
.label {
  font-size: var(--fs-small);
  font-weight: 700;
  color: var(--text-soft);
}
.swatch:has(input:checked) .label {
  color: var(--text);
}
.swatch input {
  position: absolute;
  z-index: 1;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
</style>
