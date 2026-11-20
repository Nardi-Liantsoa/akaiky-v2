<script setup lang="ts">
import { RouterLink, useRouter, type RouteLocationRaw } from 'vue-router'
import { backTo } from '../../lib/navigation'
import AppIcon from './AppIcon.vue'

// Lien de retour en tête d'écran (« ‹ Réglages », « ‹ Accueil » ; NAR-185, NAR-195) :
// vrai lien (adresse visible, ouverture dans un onglet), mais le clic passe par backTo :
// retour de l'historique si l'écran précédent est la cible, sinon remplacement.
// label : texte affiché ; ariaLabel : nom complet lu (« Retour à l'accueil »).
const props = defineProps<{ to: RouteLocationRaw, label: string, ariaLabel?: string }>()
const router = useRouter()
const back = () => backTo(router, props.to)
</script>

<template>
  <RouterLink v-slot="{ href }" :to="to" custom>
    <a :href="href" class="back" :aria-label="ariaLabel" @click.prevent="back">
      <AppIcon name="chevron-left" :size="20" />
      <span>{{ label }}</span>
    </a>
  </RouterLink>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--tap);
  margin: calc(-1 * var(--space-2)) 0 0 calc(-1 * var(--space-2));
  padding: 0 var(--space-3) 0 var(--space-1);
  border-radius: var(--radius-pill);
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
.back:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
</style>
