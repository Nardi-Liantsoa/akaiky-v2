<script setup lang="ts">
import { useId, useSlots } from 'vue'

// Carte de section commune (NAR-186) : titre h2 qui nomme la section, texte d'aide
// facultatif sous le titre, contenu en emplacement par défaut. L'emplacement « aside »
// se place à droite du titre (compteur « 4 sur 6 »…). Attributs (id, tabindex, classe)
// posés sur la <section>. level 1 : titre de la page (carte seule sur sa page, sections
// de Réglages, NAR-185), même apparence qu'un h2.
withDefaults(defineProps<{ title: string, help?: string, level?: 1 | 2 }>(), { help: undefined, level: 2 })
const slots = useSlots()
const titleId = useId()
</script>

<template>
  <section class="card section-card" :aria-labelledby="titleId">
    <div v-if="slots.aside" class="section-head">
      <component :is="`h${level}`" :id="titleId" class="section-title">{{ title }}</component>
      <slot name="aside" />
    </div>
    <component :is="`h${level}`" v-else :id="titleId" class="section-title">{{ title }}</component>
    <p v-if="help" class="help section-help">{{ help }}</p>
    <slot />
  </section>
</template>

<style scoped>
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
  margin: 0 0 var(--space-3);
}
.section-title {
  margin: 0 0 var(--space-3);
}
h1.section-title {
  font-size: var(--fs-h2);
  font-weight: 800;
  line-height: inherit;
  letter-spacing: normal;
}
.section-head .section-title {
  margin: 0;
}
/* Aide sous le titre : resserrée contre lui. */
.section-title + .section-help,
.section-head + .section-help {
  margin-top: calc(-1 * var(--space-2));
}
</style>
