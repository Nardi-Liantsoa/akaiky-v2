<script setup lang="ts">
import { useId, useSlots } from 'vue'

// Carte de section commune (NAR-186) : titre h2 qui nomme la section, texte d'aide
// facultatif sous le titre, contenu en emplacement par défaut. L'emplacement « aside »
// se place à droite du titre (compteur « 4 sur 6 »…). Attributs (id, tabindex, classe)
// posés sur la <section>.
defineProps<{ title: string, help?: string }>()
const slots = useSlots()
const titleId = useId()
</script>

<template>
  <section class="card section-card" :aria-labelledby="titleId">
    <div v-if="slots.aside" class="section-head">
      <h2 :id="titleId" class="section-title">{{ title }}</h2>
      <slot name="aside" />
    </div>
    <h2 v-else :id="titleId" class="section-title">{{ title }}</h2>
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
.section-head .section-title {
  margin: 0;
}
/* Aide sous le titre : resserrée contre lui. */
.section-title + .section-help,
.section-head + .section-help {
  margin-top: calc(-1 * var(--space-2));
}
</style>
