<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import TabBar from '../../components/parent/TabBar.vue'
import PushBanner from '../../components/parent/PushBanner.vue'
import SosBanner from '../../components/parent/SosBanner.vue'
import { auth } from '../../store/auth'
import { family } from '../../store/family'

const route = useRoute()
const router = useRouter()
const showTabs = computed(() => family.status === 'ready' || family.status === 'error')
// Écrans en grille sur ordinateur (accueil, Réglages) : colonne large ; les autres (formulaires,
// journal, famille) gardent une largeur de lecture de 720 px (NAR-223).
const wide = computed(() => route.matched.some((r) => r.meta.wide))
// Alerte SOS (NAR-249) : plein écran, sans onglets ni marges ; le retour se fait par l'écran.
const alert = computed(() => route.matched.some((r) => r.meta.alert))
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
  <main v-if="alert" class="alert-shell">
    <!-- Une autre alerte en cours (second enfant) reste visible au-dessus de celle-ci. -->
    <SosBanner edge />
    <RouterView />
  </main>
  <main v-else class="shell" :class="{ 'with-tabs': showTabs, wide }">
    <!-- Alertes SOS en cours de la famille, en tête de chaque onglet (NAR-249). -->
    <SosBanner v-if="family.status === 'ready' || family.status === 'error'" />
    <RouterView />
  </main>
  <!-- Onglets seulement quand la famille est connue (ou injoignable) : jamais pendant
       la création ni pendant le premier chargement. Après le contenu, comme la barre du
       bas qui les montre en dernier sur téléphone. -->
  <TabBar v-if="showTabs && !alert" />
  <!-- Notification reçue au premier plan (NAR-179). -->
  <PushBanner />
</template>

<style scoped>
.alert-shell {
  max-width: 720px;
  margin: 0 auto;
}

.shell {
  /* Zones sûres en natif comme sur le web (viewport-fit=cover) : --safe-* vaut 0 sans encoche.
     Haut : la barre d'état recouvre la WebView (main.ts) ; sans --safe-top, le titre la touche. */
  padding: calc(var(--space-5) + var(--safe-top)) calc(var(--gutter) + var(--safe-right)) calc(var(--tab-height) + var(--safe-bottom) + var(--space-5))
    calc(var(--gutter) + var(--safe-left));
  max-width: 720px;
  margin: 0 auto;
}
/* Ordinateur (NAR-208) : les onglets sont un rail à gauche. La colonne est centrée dans
   la place restante, et le bas n'a plus de barre à éviter. */
@media (min-width: 1024px) {
  .shell.with-tabs {
    /* Zone sûre de gauche déjà sous le rail : comptée une fois, dans la marge. */
    padding-left: var(--gutter);
    padding-bottom: calc(var(--space-5) + var(--safe-bottom));
    margin-left: calc(var(--rail-width) + var(--safe-left) + max(0px, (100% - var(--rail-width) - var(--safe-left) - 720px) / 2));
    margin-right: auto;
  }
  .shell.with-tabs.wide {
    max-width: var(--wide-width);
    padding-right: calc(var(--gutter) + var(--safe-right));
    margin-left: calc(var(--rail-width) + var(--safe-left) + max(0px, (100% - var(--rail-width) - var(--safe-left) - var(--wide-width)) / 2));
  }
}
</style>
