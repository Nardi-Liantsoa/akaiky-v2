<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { auth, isAdmin, logout } from './store/auth'
import { useT, locale, LOCALE_LIST } from './composables/useT'
import { currentKind } from './lib/appKind'
import AppButton from './components/ui/AppButton.vue'

const t = useT()
const router = useRouter()
const route = useRoute()

// Écrans de la coquille parent : la barre d'onglets est la seule navigation (NAR-156),
// compte, sécurité, langue et déconnexion sont dans l'onglet Famille. L'en-tête reste
// au visiteur (accueil public, connexion) et au back-office. Avant la première
// navigation (route de départ, sans correspondance), l'adresse demandée décide :
// aucun en-tête ne clignote à l'ouverture d'un écran parent.
const inShell = computed(() =>
  (route.matched.length ? route.matched : router.resolve(window.location.pathname).matched).some((r) => r.meta.parentShell))

async function onLogout() {
  await logout()
  router.push({ name: 'accueil' })
}
</script>

<template>
  <!-- En-tête dès que l'on sait être l'app parent (immédiat sur le web), sans attendre
       /auth/me ; jamais dans l'app enfant, pas même pendant la lecture de l'identifiant,
       ni dans la coquille parent (barre d'onglets). -->
  <header v-if="currentKind === 'parent' && !inShell" class="nav">
    <RouterLink class="brand" :to="{ name: 'accueil' }">Akaiky</RouterLink>
    <nav>
      <template v-if="auth.user">
        <RouterLink :to="{ name: 'securite' }">{{ t.nav.security }}</RouterLink>
        <RouterLink v-if="isAdmin()" :to="{ name: 'admin' }">{{ t.nav.admin }}</RouterLink>
        <AppButton variant="link" class="logout" @click="onLogout">{{ t.nav.logout }}</AppButton>
      </template>
      <RouterLink v-else :to="{ name: 'connexion' }">{{ t.nav.login }}</RouterLink>
      <select v-model="locale" class="lang" :aria-label="t.lang.label">
        <option v-for="l in LOCALE_LIST" :key="l" :value="l">{{ t.lang[l] }}</option>
      </select>
    </nav>
  </header>

  <RouterView />
</template>

<style scoped>
.nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  padding: 16px var(--gutter);
  border-bottom: 1px solid var(--border);
}
.brand {
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  color: var(--text);
}
nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  font-size: 0.92rem;
}
/* Zone tactile de 48 px sans grandir l'en-tête : la rangée garde la hauteur d'une ligne. */
.logout {
  margin-block: calc((1.5em - var(--tap)) / 2);
}
.lang {
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font: inherit;
}
</style>
