<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useT } from '../../composables/useT'
import { auth } from '../../store/auth'
import { family } from '../../store/family'
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'
import ChildAvatar from './ChildAvatar.vue'

const t = useT()
// Nom de l'app, le même dans les trois langues.
const APP_NAME = 'Akaiky'
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

// Écrans rangés sous un onglet hors de son chemin : « Mon compte » (/espace/compte/*,
// la sécurité) s'ouvre depuis Famille, qui reste signalé (NAR-156).
const EXTRA: Partial<Record<(typeof TABS)[number]['name'], string[]>> = { famille: ['/espace/compte'] }

// Onglet actif : celui dont le chemin est le plus long préfixe de l'URL, pour
// qu'un écran imbriqué (ex. /espace/famille/:id) garde son onglet signalé.
const BY_DEPTH = TABS.flatMap((tab) => [router.resolve({ name: tab.name }).path, ...(EXTRA[tab.name] ?? [])]
  .map((path) => ({ name: tab.name, path })))
  .sort((a, b) => b.path.length - a.path.length)
const active = computed(() =>
  BY_DEPTH.find((tab) => route.path === tab.path || route.path.startsWith(`${tab.path}/`))?.name)
</script>

<template>
  <nav class="tabbar" :aria-label="t.parent.tabsLabel">
    <!-- Ordinateur seulement (NAR-223, maquettes 02 et 05) : nom de l'app en tête, compte en bas. -->
    <!-- Liens sans aria-current : seul l'onglet signale la page ouverte. -->
    <RouterLink v-slot="{ href, navigate }" :to="{ name: 'espace' }" custom>
      <a :href="href" class="brand" :aria-label="`${APP_NAME}, ${t.parent.home.title.toLocaleLowerCase()}`" @click="navigate">
        <span class="logo" aria-hidden="true">{{ APP_NAME[0] }}</span>
        <span aria-hidden="true">{{ APP_NAME }}</span>
      </a>
    </RouterLink>
    <RouterLink v-for="tab in TABS" :key="tab.name" v-slot="{ href, navigate }" :to="{ name: tab.name }" custom>
      <a :href="href" class="tab" :aria-current="active === tab.name ? 'page' : undefined" @click="navigate">
        <AppIcon :name="tab.icon" />
        <span>{{ t.parent[tab.key].title }}</span>
      </a>
    </RouterLink>
    <RouterLink v-if="auth.user" v-slot="{ href, navigate }" :to="{ name: 'securite' }" custom>
      <a :href="href" class="account" @click="navigate">
        <ChildAvatar :name="auth.user.name" color="blue" :size="40" />
        <span class="who">
          <span class="name">{{ auth.user.name }}</span>
          <span v-if="family.data" class="family">{{ family.data.name }}</span>
        </span>
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
.tab:focus-visible,
.brand:focus-visible,
.account:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -3px;
}
/* Nom de l'app et compte : barre latérale de l'ordinateur seulement. */
.brand,
.account {
  display: none;
}
/* Grands écrans (NAR-208). Tablette : onglets regroupés au centre, sous la colonne de
   contenu (720 px), au lieu d'être étalés sur toute la largeur. */
@media (min-width: 768px) {
  .tabbar {
    grid-template-columns: repeat(4, minmax(0, 160px));
    justify-content: center;
  }
}
/* Ordinateur (NAR-223, maquettes 02 et 05) : barre latérale pleine hauteur, nom de l'app en
   tête, onglets en lignes (icône puis libellé), compte en bas. Mêmes liens, même ordre. */
@media (min-width: 1024px) {
  .tabbar {
    inset: 0 auto 0 0;
    width: calc(var(--rail-width) + var(--safe-left));
    height: 100dvh;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: calc(var(--space-5) + var(--safe-top)) var(--space-3) calc(var(--space-4) + var(--safe-bottom)) calc(var(--space-3) + var(--safe-left));
    border-top: none;
    border-right: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap);
    margin: 0 0 var(--space-4);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 1.4rem;
    font-weight: 900;
    text-decoration: none;
  }
  .logo {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 1.2rem;
  }
  .tab {
    flex-direction: row;
    justify-content: flex-start;
    gap: var(--space-3);
    min-height: 52px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    font-size: 1.05rem;
    text-align: left;
  }
  .tab:hover {
    background: var(--bg);
    text-decoration: none;
  }
  .tab[aria-current='page'] {
    background: var(--accent-soft);
  }
  .account {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: auto;
    padding: var(--space-4) var(--space-2) 0;
    border-top: 1px solid var(--border);
    color: var(--text);
    text-decoration: none;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 800;
  }
  .family {
    overflow: hidden;
    color: var(--text-soft);
    font-size: var(--fs-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
