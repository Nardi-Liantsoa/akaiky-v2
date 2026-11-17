<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useT } from '../../composables/useT'

const t = useT()

// Ordre et icônes de la maquette (docs/DESIGN.md, app parent). Les icônes sont
// des tracés en ligne, sans bibliothèque : rien de plus à embarquer.
const TABS = [
  { name: 'espace', key: 'home', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { name: 'journal', key: 'log', icon: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' },
  { name: 'reglages', key: 'settings', icon: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  { name: 'famille', key: 'family', icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' }
] as const
</script>

<template>
  <nav class="tabbar" :aria-label="t.parent.tabsLabel">
    <RouterLink v-for="tab in TABS" :key="tab.name" :to="{ name: tab.name }" class="tab">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path :d="tab.icon" />
      </svg>
      <span>{{ t.parent[tab.key].title }}</span>
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
  height: var(--tab-height);
  background: var(--surface-card);
  border-top: 1px solid var(--border);
}
.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--tap);
  color: var(--ink-soft);
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
/* RouterLink pose aria-current="page" sur l'onglet exactement actif. */
.tab[aria-current='page'] {
  color: var(--call);
  font-weight: 800;
}
.tab:focus-visible {
  outline: 3px solid var(--call);
  outline-offset: -3px;
}
</style>
