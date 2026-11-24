<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import TabBar from '../../components/parent/TabBar.vue'
import { auth } from '../../store/auth'
import { family } from '../../store/family'

const route = useRoute()
const router = useRouter()
const showTabs = computed(() => family.status === 'ready' || family.status === 'error')
// Famille disparue en cours de route (rechargement → no_family, membre retiré) :
// retour à l'accueil, qui présente la création, plutôt qu'un écran vide sans onglets.
watch(() => family.status, (status) => {
  if (status === 'none' && route.meta.requiresFamily) void router.replace({ name: 'espace' })
})
// Session perdue sur place (401 pendant un chargement) : connexion, puis retour ici.
// Une déconnexion volontaire navigue elle-même ensuite, et sa navigation l'emporte.
watch(() => auth.user, (user) => {
  if (!user) void router.replace({ name: 'connexion', query: { next: route.fullPath } })
})
</script>

<template>
  <main class="shell" :class="{ 'with-tabs': showTabs }">
    <RouterView />
  </main>
  <!-- Onglets seulement quand la famille est connue (ou injoignable) : jamais pendant
       la création ni pendant le premier chargement. Après le contenu, comme la barre du
       bas qui les montre en dernier sur téléphone. -->
  <TabBar v-if="showTabs" />
</template>

<style scoped>
.shell {
  /* Zones sûres en natif comme sur le web (viewport-fit=cover) : --safe-* vaut 0 sans encoche. */
  padding: var(--space-5) calc(var(--gutter) + var(--safe-right)) calc(var(--tab-height) + var(--safe-bottom) + var(--space-5))
    calc(var(--gutter) + var(--safe-left));
  max-width: 720px;
  margin: 0 auto;
}
/* Ordinateur (NAR-208) : les onglets sont un rail à gauche. La colonne est centrée dans
   la place restante, et le bas n'a plus de barre à éviter. */
@media (min-width: 1024px) {
  .shell.with-tabs {
    /* Zone sûre de gauche déjà sous le rail : comptée une fois, dans la marge. */
    padding-top: calc(var(--space-5) + var(--safe-top));
    padding-left: var(--gutter);
    padding-bottom: calc(var(--space-5) + var(--safe-bottom));
    margin-left: calc(var(--rail-width) + var(--safe-left) + max(0px, (100% - var(--rail-width) - var(--safe-left) - 720px) / 2));
    margin-right: auto;
  }
}
</style>
