<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getJournal, type JournalItem } from '../../api/journal'
import { markShownAsRead } from '../../api/messages'
import { useT } from '../../composables/useT'
import { groupByDay } from '../../lib/groupByDay'
import { selectChild } from '../../store/children'
import { canManage } from '../../store/family'
import LogItem from '../log/LogItem.vue'
import StatusBlock from '../ui/StatusBlock.vue'

// « Aujourd'hui » sur l'accueil parent (NAR-152, maquette écran 6) : les 3 derniers
// événements du jour, puis « Tout le journal ». Messages affichés = vus (NAR-150). Relu
// toutes les 30 s tant que l'accueil est ouvert (le push viendra avec NAR-141).
// bare : sans cadre de carte (affiché dans la carte dépliée de l'enfant, NAR-174).
// untitled : sans titre, posé sous le bouton « Aujourd'hui » qui le déplie (NAR-193).
// title : autre titre (« Derniers événements », panneau de l'ordinateur, maquette 02).
const props = defineProps<{ childId: string, bare?: boolean, untitled?: boolean, title?: string }>()
const t = useT()
const items = ref<JournalItem[]>([])
const status = ref<'loading' | 'ready' | 'error'>('loading')
// Enfant dont les éléments affichés proviennent (null : relecture en échec).
const loadedFor = ref<string | null>(null)
let generation = 0

async function load() {
  const mine = ++generation
  const childId = props.childId
  try {
    const page = await getJournal(childId, { limit: 3 })
    if (mine !== generation) return
    const today = groupByDay(page.items, (i) => i.at).find((g) => g.when === 'today')
    items.value = today?.items ?? []
    status.value = 'ready'
    loadedFor.value = childId
    if (await markShownAsRead(items.value) && mine === generation) {
      const fresh = await getJournal(childId, { limit: 3 }).catch(() => null)
      if (fresh && mine === generation) {
        const byId = new Map(fresh.items.map((i) => [i.id, i]))
        items.value = items.value.map((i) => byId.get(i.id) ?? i)
      }
    }
  } catch {
    if (mine !== generation) return
    if (loadedFor.value !== childId) loadedFor.value = null
    if (status.value !== 'ready') status.value = 'error'
  }
}
// Autre enfant : la carte garde son contenu, estompé et inactif, jusqu'aux nouvelles données.
const reloading = ref(false)
watch(() => props.childId, async (childId) => {
  reloading.value = true
  await load()
  if (props.childId !== childId) return
  reloading.value = false
  // Échec pour le nouvel enfant : jamais l'activité de l'enfant précédent affichée.
  if (status.value === 'ready' && !loadedFor.value) { items.value = []; status.value = 'error' }
}, { immediate: true })
const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
onBeforeUnmount(() => { clearInterval(timer); generation++ })
</script>

<template>
  <section
    class="today" :class="{ card: !bare, bare, untitled, stale: reloading && status === 'ready' }" :aria-busy="reloading"
    :aria-label="untitled ? t.parent.log.todayTitle : undefined"
  >
    <header>
      <h2 v-if="!untitled">{{ title ?? t.parent.log.todayTitle }}</h2>
      <!-- Plusieurs « Aujourd'hui » ouverts : le journal ouvert est celui de CET enfant. -->
      <RouterLink v-if="!title" class="all" :to="{ name: 'journal' }" @click="selectChild(childId)">{{ t.parent.log.allLog }}</RouterLink>
    </header>
    <StatusBlock v-if="status === 'error'" state="error" :text="t.parent.log.loadError" @retry="load" />
    <ul v-else-if="items.length" class="list">
      <LogItem v-for="i in items" :key="i.id" :item="i" :child-id="childId" :can-allow="canManage()" />
    </ul>
    <StatusBlock v-else-if="status === 'ready'" state="empty" :text="t.parent.log.nothingToday" />
    <!-- Panneau « Derniers événements » de l'ordinateur (maquette 02) : lien en bas, avec une flèche. -->
    <RouterLink v-if="title" class="all see-all" :to="{ name: 'journal' }" @click="selectChild(childId)">
      {{ t.parent.log.seeAll }}<AppIcon name="chevron-right" :size="18" />
    </RouterLink>
  </section>
</template>

<style scoped>
.stale {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.15s;
}
.bare {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  /* Hauteur réservée : la carte dépliée ne grandit pas une seconde fois au chargement. */
  min-height: 140px;
}
.today:not(.bare) {
  margin-top: 16px;
  /* Hauteur réservée : la carte ne saute pas pendant une relecture (changement d'enfant). */
  min-height: 120px;
}
/* Sous le bouton qui le déplie : ni second trait ni titre, « Tout le journal » à droite. */
.bare.untitled {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.untitled header {
  justify-content: flex-end;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0 0 4px;
}
/* Cible tactile ≥ 48 px (NAR-192). */
.all {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
.see-all {
  gap: var(--space-1);
  margin-top: var(--space-2);
}
.all:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
