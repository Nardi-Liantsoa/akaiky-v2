<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useT } from '../../composables/useT'

const t = useT()
const route = useRoute()
const router = useRouter()

// Ordre et icônes de la maquette (docs/DESIGN.md, app parent). Les icônes sont
// des tracés en ligne, sans bibliothèque : rien de plus à embarquer.
const TABS = [
  { name: 'espace', key: 'home', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { name: 'journal', key: 'log', icon: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' },
  { name: 'reglages', key: 'settings', icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { name: 'famille', key: 'family', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' }
] as const

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
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path :d="tab.icon" />
        </svg>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--tap);
  color: var(--text-soft);
  font-size: 0.8rem;
  font-weight: 700;
  text-decoration: none;
}
.tab svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
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
