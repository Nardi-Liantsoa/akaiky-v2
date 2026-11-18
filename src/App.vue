<script setup lang="ts">
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { auth, isAdmin, logout } from './store/auth'
import { useT, locale, LOCALE_LIST } from './composables/useT'

const t = useT()
const router = useRouter()
const route = useRoute()

async function onLogout() {
  await logout()
  router.push({ name: 'accueil' })
}
</script>

<template>
  <!-- L'app enfant n'a ni compte ni navigation : pas d'en-tête. -->
  <header v-if="!route.meta.childApp" class="nav">
    <RouterLink class="brand" :to="{ name: 'accueil' }">Akaiky</RouterLink>
    <nav>
      <template v-if="auth.user">
        <RouterLink :to="{ name: 'espace' }">{{ t.nav.space }}</RouterLink>
        <RouterLink :to="{ name: 'securite' }">{{ t.nav.security }}</RouterLink>
        <RouterLink v-if="isAdmin()" :to="{ name: 'admin' }">{{ t.nav.admin }}</RouterLink>
        <button class="link" type="button" @click="onLogout">{{ t.nav.logout }}</button>
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
.link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
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
