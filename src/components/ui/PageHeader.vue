<script setup lang="ts">
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router'
import { backTo } from '../../lib/navigation'
import AppIcon from './AppIcon.vue'

// En-tête unique des sous-écrans (audit UI du 25/11/2026, NAR-222, maquette 07) : flèche de
// retour à gauche, titre de la page au centre (le h1), emplacement à droite (sélecteur
// d'enfant). Le retour est un vrai lien (adresse visible), nommé par backLabel
// (« Retour à l'accueil ») ; le clic passe par backTo comme BackLink. Sans title, pas de
// h1 (écran encore en chargement) : la flèche reste, la sortie est toujours possible.
const props = defineProps<{ back: RouteLocationRaw, backLabel: string, title?: string, before?: () => void }>()
defineSlots<{ aside?(): unknown }>()
const router = useRouter()
const goBack = () => { props.before?.(); return backTo(router, props.back) }
</script>

<template>
  <header class="page-header">
    <RouterLink v-slot="{ href }" :to="back" custom>
      <a :href="href" class="back" :aria-label="backLabel" @click.prevent="goBack">
        <AppIcon name="chevron-left" :size="24" />
      </a>
    </RouterLink>
    <h1 v-if="title" class="title">{{ title }}</h1>
    <span v-else />
    <div class="aside"><slot name="aside" /></div>
  </header>
</template>

<style scoped>
.page-header {
  display: grid;
  grid-template-columns: var(--tap) minmax(0, 1fr) minmax(var(--tap), auto);
  align-items: center;
  gap: var(--space-2);
  margin: calc(-1 * var(--space-2)) 0 var(--space-5) calc(-1 * var(--space-2));
}
.back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  color: var(--text);
}
.back:hover {
  background: var(--surface-muted);
  text-decoration: none;
}
.back:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.title {
  margin: 0;
  font-size: clamp(1.25rem, 1rem + 1vw, 1.75rem);
  text-align: center;
}
.aside {
  display: flex;
  justify-content: flex-end;
}
</style>
