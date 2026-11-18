<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { getJournal, type JournalFilter, type JournalItem } from '../../api/journal'
import { markShownAsRead } from '../../api/messages'
import LoadError from '../../components/family/LoadError.vue'
import LogFilters from '../../components/log/LogFilters.vue'
import LogItem from '../../components/log/LogItem.vue'
import ChildPicker from '../../components/parent/ChildPicker.vue'
import EmptyState from '../../components/parent/EmptyState.vue'
import { locale, useT } from '../../composables/useT'
import { formatLongDate } from '../../lib/format'
import { groupByDay } from '../../lib/groupByDay'
import { children, loadChildren, selectedChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'

// Journal de l'enfant (NAR-152, maquette écran 9) : appels, appels bloqués, déverrouillages
// et messages, groupés par jour, filtrables, par pages. Messages affichés = vus.
const t = useT()
const current = computed(selectedChild)
const filter = ref<JournalFilter>('all')
const items = ref<JournalItem[]>([])
const next = ref<string | null>(null)
// null : compteur inconnu (chargement d'un autre enfant), affiché sans nombre.
const blocked = ref<number | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const loadingMore = ref(false)
const refreshing = ref(false)
let generation = 0

onMounted(() => { void loadFamily() })
watch(() => family.status, (s) => { if (s === 'ready') void loadChildren(true) }, { immediate: true })

async function load() {
  const childId = current.value?.id
  if (!childId) return
  const mine = ++generation
  // Liste déjà affichée : gardée (estompée) pendant la relecture, jamais vidée, sinon
  // l'écran « clignote » à chaque filtre. Seul le tout premier chargement l'attend.
  if (status.value !== 'ready') status.value = 'loading'
  refreshing.value = true
  try {
    const page = await getJournal(childId, { kind: filter.value, counts: true })
    if (mine !== generation) return
    items.value = page.items
    next.value = page.next
    if (page.counts) blocked.value = page.counts.blocked
    status.value = 'ready'
    // Données affichées : la liste redevient nette tout de suite (le « vu » suit en fond).
    refreshing.value = false
    if (await markShownAsRead(page.items) && mine === generation) {
      // « Vu par » relu : chaque élément déjà affiché est mis à jour par identifiant, la
      // liste et le curseur ne bougent pas (rien de perdu, rien de doublé).
      const fresh = await getJournal(childId, { kind: filter.value }).catch(() => null)
      if (fresh && mine === generation) {
        const byId = new Map(fresh.items.map((i) => [i.id, i]))
        items.value = items.value.map((i) => byId.get(i.id) ?? i)
      }
    }
  } catch {
    if (mine === generation) status.value = 'error'
  } finally {
    if (mine === generation) refreshing.value = false
  }
}
// Autre enfant : rien de l'enfant précédent ne reste affiché.
// Autre enfant : la liste précédente reste affichée, estompée et inactive, jusqu'à la
// nouvelle (pas de clignement) ; compteur et curseur repartent de zéro.
watch(() => current.value?.id, () => { next.value = null; blocked.value = null; loadingMore.value = false; refreshing.value = true })
watch(() => [current.value?.id, filter.value] as const, () => { void load() }, { immediate: true })

async function more() {
  const childId = current.value?.id
  // Pendant une relecture (filtre, enfant), le curseur est celui de l'ancienne liste.
  if (!childId || !next.value || loadingMore.value || refreshing.value) return
  const mine = generation
  loadingMore.value = true
  try {
    const page = await getJournal(childId, { kind: filter.value, before: next.value })
    if (mine !== generation) return
    items.value = [...items.value, ...page.items]
    next.value = page.next
    void markShownAsRead(page.items)
  } catch {
    // Bouton toujours là : nouvel essai possible.
  } finally {
    loadingMore.value = false
  }
}

const groups = computed(() => groupByDay(items.value, (i) => i.at))
const dayLabel = (g: { when: string, date: Date }) =>
  g.when === 'today' ? t.value.parent.log.today : g.when === 'yesterday' ? t.value.parent.log.yesterday : formatLongDate(g.date, locale.value)
</script>

<template>
  <LoadError v-if="family.status === 'error'" />
  <section v-else-if="family.status === 'ready'">
    <h1>{{ t.parent.log.title }}</h1>
    <template v-if="children.status === 'ready' && current">
      <ChildPicker v-if="children.items.length > 1" />
      <LogFilters v-model="filter" :blocked="blocked" />
      <p v-if="status === 'error'" class="error" role="alert">{{ t.parent.log.loadError }}</p>
      <div v-else-if="status === 'ready' && !items.length" class="card"><p class="empty">{{ t.parent.log.empty }}</p></div>
      <div v-else-if="status === 'ready'" class="card" :class="{ refreshing }" :aria-busy="refreshing">
        <section v-for="g in groups" :key="g.key" class="day">
          <h2>{{ dayLabel(g) }}</h2>
          <ul class="list">
            <LogItem v-for="i in g.items" :key="i.id" :item="i" :child-id="current.id" :can-allow="canManage()" />
          </ul>
        </section>
        <button v-if="next" class="btn btn-ghost more" type="button" :disabled="loadingMore || refreshing" @click="more">{{ t.parent.log.more }}</button>
      </div>
      <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
    </template>
    <EmptyState v-else-if="children.status === 'ready'" :title="t.parent.log.title" :text="t.parent.log.empty" />
    <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
  </section>
  <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
</template>

<style scoped>
h1 {
  font-size: 2rem;
  margin: 8px 0 16px;
}
.day h2 {
  margin: 16px 0 0;
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--text-soft);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.day:first-child h2 {
  margin-top: 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.refreshing {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.15s;
}
.more {
  margin-top: 12px;
}
.empty {
  margin: 0;
  color: var(--text-soft);
}
.loading {
  min-height: 30vh;
  margin: 0;
}
</style>
