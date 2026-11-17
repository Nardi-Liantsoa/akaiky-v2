<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import TabBar from '../../components/parent/TabBar.vue'
import { family } from '../../store/family'

const route = useRoute()
const router = useRouter()
// Famille disparue en cours de route (rechargement → no_family, membre retiré) :
// retour à l'accueil, qui présente la création, plutôt qu'un écran vide sans onglets.
watch(() => family.status, (status) => {
  if (status === 'none' && route.meta.requiresFamily) void router.replace({ name: 'espace' })
})
</script>

<template>
  <main class="shell">
    <RouterView />
  </main>
  <!-- Onglets seulement quand la famille est connue (ou injoignable) : jamais pendant
       la création ni pendant le premier chargement. -->
  <TabBar v-if="family.status === 'ready' || family.status === 'error'" />
</template>

<style scoped>
.shell {
  /* Zones sûres en natif comme sur le web (viewport-fit=cover) : --safe-* vaut 0 sans encoche. */
  padding: 24px calc(var(--gutter) + var(--safe-right)) calc(var(--tab-height) + var(--safe-bottom) + 24px)
    calc(var(--gutter) + var(--safe-left));
  max-width: 720px;
  margin: 0 auto;
}
</style>
