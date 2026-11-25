<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

// Section repliable d'une page longue (NAR-228, design de la page Famille, inspiré des lignes
// de Réglages) : carte dont l'en-tête (titre, résumé d'une ligne, chevron) ouvre ou ferme le
// contenu en un geste. <details>/<summary> natifs : clavier (Entrée, Espace) et lecteur
// d'écran (état déplié annoncé) sans code. `open` : dépliée au premier affichage.
// icon : pastille ronde à gauche du titre, comme les lignes de Réglages.
defineProps<{ title: string, summary?: string, open?: boolean, icon?: IconName }>()
</script>

<template>
  <details class="card disclosure" :open="open">
    <summary>
      <span v-if="icon" class="icon" aria-hidden="true"><AppIcon :name="icon" /></span>
      <span class="text">
        <!-- Titre de section (navigation par titres), permis dans <summary>. -->
        <h2 class="title">{{ title }}</h2>
        <span v-if="summary" class="summary">{{ summary }}</span>
      </span>
      <AppIcon class="chevron" name="chevron-right" :size="20" />
    </summary>
    <div class="body"><slot /></div>
  </details>
</template>

<style scoped>
.disclosure {
  padding-block: 0;
}
summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: calc(var(--tap) + var(--space-4));
  padding-block: var(--space-3);
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
  border-radius: var(--space-2);
}
.icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--ink);
}
.text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.title {
  margin: 0;
  font-size: var(--fs-h2);
  font-weight: 800;
}
.summary {
  color: var(--text-soft);
  font-size: var(--fs-small);
  font-weight: 700;
}
.chevron {
  flex: none;
  color: var(--text-soft);
  transition: transform 0.2s var(--ease);
}
details[open] .chevron {
  transform: rotate(90deg);
}
.body {
  padding-bottom: var(--space-5);
}
/* Une carte rangée dans la section (liste des membres, invitation) perd son cadre : pas de
 * double marge. */
.body :deep(.card) {
  padding: 0;
  background: none;
  box-shadow: none;
}
</style>
