<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getJournal, JOURNAL_FILTERS, type JournalFilter, type JournalItem, type JournalToday } from '../../api/journal'
import { markShownAsRead } from '../../api/messages'
import LoadError from '../../components/family/LoadError.vue'
import LogSummary from '../../components/log/LogSummary.vue'
import LogItem from '../../components/log/LogItem.vue'
import DayPicker from '../../components/log/DayPicker.vue'
import ChildSwitcher from '../../components/parent/ChildSwitcher.vue'
import { locale, useT } from '../../composables/useT'
import { dayKey, formatLongDate } from '../../lib/format'
import { dayName, shiftDay } from '../../lib/journalDay'
import { children, loadChildren, selectedChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import AppButton from '../../components/ui/AppButton.vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Journal de l'enfant (NAR-152, maquette écran 9) : appels, appels bloqués, déverrouillages
// et messages d'un jour choisi (NAR-233), filtrables, par pages. Messages affichés = vus.
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
// Jour affiché (NAR-233). null = aujourd'hui, décidé par le serveur (son horloge, jamais celle du
// téléphone) : « today » est envoyé (NAR-244 ; sans jour, le serveur rend tous les jours). Un autre jour est envoyé en « AAAA-MM-JJ ». todayKey (horloge
// du téléphone) ne sert qu'aux bornes et aux noms ; relu chaque minute et au retour sur l'écran :
// passé minuit, « aujourd'hui » suit tout seul.
// Écart en jours entre l'horloge du téléphone et le jour du serveur (NAR-244), appris à chaque
// chargement d'« aujourd'hui » : bornes et noms du sélecteur suivent le jour du serveur.
let skewDays = 0
const todayKey = ref(dayKey(new Date()))
const refreshToday = () => { todayKey.value = shiftDay(dayKey(new Date()), skewDays) }
const tick = setInterval(refreshToday, 60_000)
document.addEventListener('visibilitychange', refreshToday)
onBeforeUnmount(() => { clearInterval(tick); document.removeEventListener('visibilitychange', refreshToday) })
const day = ref<string | null>(null)
const isToday = computed(() => day.value === null)
// Date réellement affichée, rendue par le serveur : « Voir plus » et la relecture du « vu » la
// redemandent telle quelle (jamais « today » de nouveau : passé minuit, ce serait un autre jour).
const loadedDay = ref<string | null>(null)
const shownDay = computed({
  get: () => day.value ?? todayKey.value,
  set: (key: string) => { day.value = key === todayKey.value ? null : key }
})
// Minuit passé : un jour choisi qui devient aujourd'hui repasse à null ; aujourd'hui est relu.
watch(todayKey, (key, old) => {
  if (day.value === key) day.value = null
  else if (day.value === null && key !== old) void load()
})
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
    const page = await getJournal(childId, { kind: filter.value, counts: true, day: day.value ?? 'today' })
    if (mine !== generation) return
    loadedDay.value = page.day ?? day.value
    if (day.value === null && page.day) {
      const phone = dayKey(new Date())
      skewDays = Math.max(-1, Math.min(1, Math.round((Date.parse(page.day) - Date.parse(phone)) / 86_400_000)))
      todayKey.value = page.day
    }
    items.value = page.items
    next.value = page.next
    if (page.today) today.value = page.today
    status.value = 'ready'
    // Données affichées : la liste redevient nette tout de suite (le « vu » suit en fond).
    refreshing.value = false
    if (await markShownAsRead(page.items) && mine === generation) {
      // « Vu par » relu : chaque élément déjà affiché est mis à jour par identifiant, la
      // liste et le curseur ne bougent pas (rien de perdu, rien de doublé).
      const fresh = await getJournal(childId, { kind: filter.value, day: loadedDay.value ?? day.value ?? 'today' }).catch(() => null)
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
// Autre jour : même règle que le filtre (liste gardée estompée, curseur oublié).
watch(day, () => { next.value = null; loadingMore.value = false })
watch(() => [current.value?.id, filter.value, day.value] as const, () => { void load() }, { immediate: true })

async function more() {
  const childId = current.value?.id
  // Pendant une relecture (filtre, enfant), le curseur est celui de l'ancienne liste.
  if (!childId || !next.value || loadingMore.value || refreshing.value) return
  const mine = generation
  loadingMore.value = true
  try {
    const page = await getJournal(childId, { kind: filter.value, before: next.value, day: loadedDay.value ?? day.value ?? 'today' })
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

// Nom du jour pour la liste (lecteurs d'écran) : le même que celui du sélecteur.
const listLabel = computed(() => dayName(shownDay.value, todayKey.value, t.value.parent.log, (d) => formatLongDate(d, locale.value)))
</script>

<template>
  <LoadError v-if="family.status === 'error'" />
  <!-- Un seul bloc de chargement (famille, enfants puis journal) : annoncé une fois. -->
  <section v-else>
    <!-- Sélecteur d'enfant à droite du titre, sur la même ligne (maquette 05, NAR-231). -->
    <div class="log-head">
      <h1>{{ t.parent.log.title }}</h1>
      <span v-if="listed && current && children.items.length > 1" class="head-switch"><ChildSwitcher /></span>
    </div>
    <template v-if="listed && current">
      <DayPicker v-model="shownDay" :today-key="todayKey" />
      <LogSummary v-model="filter" :today="today" :title="isToday ? t.parent.log.summaryTitle : t.parent.log.summaryTitleDay" />
      <!-- Zone annoncée toujours présente (une zone insérée déjà remplie n'est pas lue) ;
           le bouton est à côté, pas dedans. -->
      <!-- Information (NAR-235), toujours là : comment filtrer, puis comment tout réafficher.
           Hors de la zone annoncée (role=status) : le filtre choisi y est déjà dit. -->
      <p class="filter-hint"><AppIcon name="info" :size="18" />{{ filter === 'all' ? t.parent.log.filterHint : t.parent.log.filterHintActive }}</p>
      <!-- Filtre choisi : annoncé aux lecteurs d'écran seulement (NAR-243) ; à l'écran, la tuile
           cochée et le bandeau le disent, la retoucher affiche tout. -->
      <p role="status" class="visually-hidden">{{ filter !== 'all' ? t.parent.log.activeFilter(t.parent.log.summary[filter]) : '' }}</p>
    </template>
    <StatusBlock v-if="loading" state="loading" fill />
    <template v-else-if="listed && current">
      <StatusBlock v-if="status === 'error'" state="error" :text="t.parent.log.loadError" @retry="load" />
      <StatusBlock v-else-if="!items.length" state="empty" card :text="isToday && filter === 'all' ? t.parent.log.empty : t.parent.log.emptyDay" />
      <!-- Un seul jour (NAR-233) : une carte qui défile (NAR-231), nommée pour les lecteurs
           d'écran ; atteignable au clavier. Clé avec jour, filtre et enfant : un autre contenu
           repart en haut. -->
      <div v-else class="days" :class="{ refreshing }" :aria-busy="refreshing">
        <ul :key="`${shownDay}-${filter}-${current.id}`" class="card list bounded" tabindex="0" :aria-label="listLabel">
          <LogItem v-for="i in items" :key="i.id" :item="i" :child-id="current.id" :can-allow="canManage()" />
        </ul>
        <AppButton v-if="next" variant="ghost" class="more" :disabled="loadingMore || refreshing" @click="more">{{ t.parent.log.more }}</AppButton>
      </div>
    </template>
    <StatusBlock v-else-if="children.status === 'error'" state="error" :text="t.children.loadError" @retry="loadChildren(true)" />
    <StatusBlock v-else state="empty" card :text="t.parent.log.empty" />
  </section>
</template>

<style scoped>
.log-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  margin: 8px 0 16px;
}
h1 {
  margin: 0;
}
.head-switch :deep(.switch) {
  margin-bottom: 0;
}
/* Bandeau d'information : fond neutre (jamais la teinte d'une tuile : le bleu est celui des
 * appels), icône « i », texte d'aide (jamais une action). */
.filter-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 var(--space-4);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  color: var(--text);
  font-size: var(--fs-small);
  font-weight: 600;
}
.filter-hint :deep(svg) {
  flex: none;
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
