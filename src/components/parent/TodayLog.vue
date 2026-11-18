<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getJournal, type JournalItem } from '../../api/journal'
import { markShownAsRead } from '../../api/messages'
import { useT } from '../../composables/useT'
import { groupByDay } from '../../lib/groupByDay'
import { canManage } from '../../store/family'
import LogItem from '../log/LogItem.vue'

// « Aujourd'hui » sur l'accueil parent (NAR-152, maquette écran 6) : les 3 derniers
// événements du jour, puis « Tout le journal ». Messages affichés = vus (NAR-150). Relu
// toutes les 30 s tant que l'accueil est ouvert (le push viendra avec NAR-141).
// bare : sans cadre de carte (affiché dans la carte dépliée de l'enfant, NAR-174).
const props = defineProps<{ childId: string, bare?: boolean }>()
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
  <section class="today" :class="{ card: !bare, bare, stale: reloading && status === 'ready' }" :aria-busy="reloading">
    <header>
      <h2>{{ t.parent.log.todayTitle }}</h2>
      <RouterLink class="all" :to="{ name: 'journal' }">{{ t.parent.log.allLog }}</RouterLink>
    </header>
    <p v-if="status === 'error'" class="error" role="alert">{{ t.parent.log.loadError }}</p>
    <ul v-else-if="items.length" class="list">
      <LogItem v-for="i in items" :key="i.id" :item="i" :child-id="childId" :can-allow="canManage()" />
    </ul>
    <p v-else-if="status === 'ready'" class="empty">{{ t.parent.log.nothingToday }}</p>
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
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0 0 4px;
  font-size: 1.15rem;
  font-weight: 800;
}
.all {
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
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
.empty {
  margin: 4px 0 0;
  color: var(--text-soft);
}
</style>
