<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useT } from '../../composables/useT'
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'

const t = useT()
const route = useRoute()
const router = useRouter()

// Ordre et icônes de la maquette (docs/DESIGN.md, app parent), tirées du jeu commun
// (AppIcon) ; décoratives, le libellé de l'onglet porte le nom.
const TABS = [
  { name: 'espace', key: 'home', icon: 'home' },
  { name: 'journal', key: 'log', icon: 'list' },
  { name: 'reglages', key: 'settings', icon: 'sliders' },
  { name: 'famille', key: 'family', icon: 'users' }
] as const satisfies readonly { name: string, key: string, icon: IconName }[]

// Onglet actif : celui dont le chemin est le plus long préfixe de l'URL, pour
// qu'un écran imbriqué (ex. /espace/famille/:id) garde son onglet signalé.
const BY_DEPTH = TABS.map((tab) => ({ name: tab.name, path: router.resolve({ name: tab.name }).path }))
  .sort((a, b) => b.path.length - a.path.length)
const active = computed(() =>
  BY_DEPTH.find((tab) => route.path === tab.path || route.path.startsWith(`${tab.path}/`))?.name)
</script>

<template>
  <nav class="tabbar" :aria-label="t.parent.tabsLabel">
    <RouterLink v-for="tab in TABS" :key="tab.name" v-slot="{ href, navigate }" :to="{ name: tab.name }" custom>
      <a :href="href" class="tab" :aria-current="active === tab.name ? 'page' : undefined" @click="navigate">
        <AppIcon :name="tab.icon" />
        <span>{{ t.parent[tab.key].title }}</span>
      </a>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  inset: auto 0 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(var(--tab-height) + var(--safe-bottom));
  padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.tab {
  min-width: 0;
  padding: 0 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--tap);
  color: var(--text-soft);
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
  text-decoration: none;
}
/* Libellés malgaches longs (« Fianakaviana ») sur un écran de 320 px. */
.tab span {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.tab[aria-current='page'] {
  color: var(--accent);
  font-weight: 800;
}
.tab:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
}
</style>
