<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { auth, isAdmin, logout } from './store/auth'
import { useT, locale, LOCALE_LIST } from './composables/useT'
import { currentKind } from './lib/appKind'
import AppButton from './components/ui/AppButton.vue'
import AppIcon from './components/ui/AppIcon.vue'

const t = useT()
// Nom de l'app, le même dans les trois langues.
const APP_NAME = 'Akaiky'
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
    <RouterLink class="brand" :to="{ name: 'accueil' }"><span class="logo" aria-hidden="true">{{ APP_NAME[0] }}</span>{{ APP_NAME }}</RouterLink>
    <nav>
      <template v-if="auth.user">
        <RouterLink :to="{ name: 'securite' }">{{ t.nav.security }}</RouterLink>
        <RouterLink v-if="isAdmin()" :to="{ name: 'admin' }">{{ t.nav.admin }}</RouterLink>
        <AppButton variant="link" class="logout" @click="onLogout">{{ t.nav.logout }}</AppButton>
      </template>
      <!-- Pas de lien vers la page où l'on est déjà (NAR-225). -->
      <RouterLink v-else-if="route.name !== 'connexion'" class="btn btn-ghost login" :to="{ name: 'connexion' }">{{ t.nav.login }}</RouterLink>
      <!-- Langue (NAR-225, maquettes 03 et 04) : pastille globe + code ; le vrai <select>, transparent
           par-dessus, garde le clavier, le lecteur d'écran et le sélecteur natif du téléphone. -->
      <label class="lang">
        <AppIcon name="globe" :size="20" />
        <span aria-hidden="true">{{ locale.toUpperCase() }}</span>
        <select v-model="locale" :aria-label="t.lang.label">
          <option v-for="l in LOCALE_LIST" :key="l" :value="l">{{ t.lang[l] }}</option>
        </select>
      </label>
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
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
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
.logo {
  display: grid;
  place-items: center;
  width: var(--space-6);
  height: var(--space-6);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--accent-ink);
}
.brand:hover {
  text-decoration: none;
}
.lang {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1.5px solid var(--border-strong);
  border-radius: var(--radius-pill);
  color: var(--text-soft);
  font-weight: 800;
}
.lang select {
  position: absolute;
  inset: 0;
  width: 100%;
  opacity: 0;
  cursor: pointer;
}
.lang:focus-within {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
</style>
