<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getJournal, JOURNAL_FILTERS, type JournalFilter, type JournalItem, type JournalToday } from '../../api/journal'
import { markShownAsRead } from '../../api/messages'
import LoadError from '../../components/family/LoadError.vue'
import LogSummary from '../../components/log/LogSummary.vue'
import LogItem from '../../components/log/LogItem.vue'
import ChildSwitcher from '../../components/parent/ChildSwitcher.vue'
import { locale, useT } from '../../composables/useT'
import { formatLongDate } from '../../lib/format'
import { groupByDay } from '../../lib/groupByDay'
import { children, loadChildren, selectedChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Journal de l'enfant (NAR-152, maquette écran 9) : appels, appels bloqués, déverrouillages
// et messages, groupés par jour, filtrables, par pages. Messages affichés = vus.
const t = useT()
const current = computed(selectedChild)
// Filtre ouvert depuis l'accueil (« Message » de la carte, NAR-227) : ?kind=messages, lu une
// fois puis retiré de l'adresse (le filtre vit ensuite à l'écran seulement : un rechargement ne
// le rétablit pas). Valeur inconnue ignorée (entrée non fiable). Appliqué après le premier
// rendu : la zone role=status existe déjà, le filtre est annoncé.
const route = useRoute()
const router = useRouter()
const filter = ref<JournalFilter>('all')
async function takeQueryFilter() {
  const raw = Array.isArray(route.query.kind) ? route.query.kind[0] : route.query.kind
  if (raw === undefined) return
  const kind = (JOURNAL_FILTERS as readonly string[]).includes(String(raw)) ? String(raw) as JournalFilter : 'all'
  const { kind: _drop, ...rest } = route.query
  void router.replace({ query: rest })
  await nextTick()
  filter.value = kind
}
onMounted(takeQueryFilter)
watch(() => route.query.kind, (k) => { if (k !== undefined) void takeQueryFilter() })
const items = ref<JournalItem[]>([])
const next = ref<string | null>(null)
// Nombres du jour (tuiles) ; null pendant le chargement d'un autre enfant.
const today = ref<JournalToday | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const loadingMore = ref(false)
const refreshing = ref(false)
let generation = 0
// Liste des enfants connue (famille et enfants chargés).
const listed = computed(() => family.status === 'ready' && children.status === 'ready')
// Chargement de la famille, des enfants ou de la première page du journal.
const loading = computed(() => family.status !== 'ready'
  || (children.status !== 'ready' && children.status !== 'error')
  || (listed.value && !!current.value && status.value === 'loading'))

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
    // Nombres du jour relus à chaque chargement (une seule requête légère) : les tuiles
    // restent d'accord avec la liste, y compris après minuit.
    const page = await getJournal(childId, { kind: filter.value, counts: true })
    if (mine !== generation) return
    items.value = page.items
    next.value = page.next
    if (page.today) today.value = page.today
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
// Autre enfant : la liste précédente reste affichée, estompée et inactive, jusqu'à la
// nouvelle (pas de clignement) ; nombres du jour et curseur repartent de zéro.
watch(() => current.value?.id, () => { next.value = null; today.value = null; loadingMore.value = false; refreshing.value = true })
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
  <!-- Un seul bloc de chargement (famille, enfants puis journal) : annoncé une fois. -->
  <section v-else>
    <h1>{{ t.parent.log.title }}</h1>
    <template v-if="listed && current">
      <ChildSwitcher v-if="children.items.length > 1" />
      <LogSummary v-model="filter" :today="today" />
      <!-- Zone annoncée toujours présente (une zone insérée déjà remplie n'est pas lue) ;
           le bouton est à côté, pas dedans. -->
      <div class="active-filter">
        <p role="status" class="filter-status">{{ filter !== 'all' ? t.parent.log.activeFilter(t.parent.log.summary[filter]) : '' }}</p>
        <AppButton v-if="filter !== 'all'" variant="link" @click="filter = 'all'">{{ t.parent.log.showAll }}</AppButton>
      </div>
    </template>
    <StatusBlock v-if="loading" state="loading" fill />
    <template v-else-if="listed && current">
      <StatusBlock v-if="status === 'error'" state="error" :text="t.parent.log.loadError" @retry="load" />
      <StatusBlock v-else-if="!items.length" state="empty" card :text="t.parent.log.empty" />
      <!-- Une carte par jour, sous un titre bien visible (NAR-175). -->
      <div v-else class="days" :class="{ refreshing }" :aria-busy="refreshing">
        <section v-for="g in groups" :key="g.key" class="day">
          <h2>{{ dayLabel(g) }}</h2>
          <!-- « Aujourd'hui » défile dans sa carte (demande utilisateur, NAR-231) : la liste du jour
               ne repousse pas les jours précédents ; zone atteignable au clavier. -->
          <ul class="card list" :class="{ bounded: g.when === 'today' }" v-bind="g.when === 'today' ? { tabindex: 0, 'aria-label': dayLabel(g) } : {}">
            <LogItem v-for="i in g.items" :key="i.id" :item="i" :child-id="current.id" :can-allow="canManage()" />
          </ul>
        </section>
        <AppButton v-if="next" variant="ghost" class="more" :disabled="loadingMore || refreshing" @click="more">{{ t.parent.log.more }}</AppButton>
      </div>
    </template>
    <StatusBlock v-else-if="children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <StatusBlock v-else state="empty" card :text="t.parent.log.empty" />
  </section>
</template>

<style scoped>
h1 {
  margin: 8px 0 16px;
}
.active-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: -4px 0 12px;
  font-weight: 700;
}
.active-filter:has(.filter-status:empty) {
  margin: 0;
}
.filter-status {
  margin: 0;
}
.day + .day {
  margin-top: 20px;
}
.day h2 {
  margin: 0 0 8px;
  font-size: 1.25rem;
  font-weight: 900;
}
.list {
  list-style: none;
  margin: 0;
  padding: 4px 16px;
}
/* Au bout de la liste, le défilement passe à la page (pas de overscroll-behavior: contain) :
 * le bas de la carte remonte au-dessus de la barre d'onglets, rien ne reste caché dessous. */
.list.bounded {
  max-height: min(440px, 50vh);
  overflow-y: auto;
}
.list.bounded:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.refreshing {
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.15s;
}
.more {
  margin-top: 12px;
}
</style>
