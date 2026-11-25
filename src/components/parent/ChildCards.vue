<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import type { Child } from '../../api/children'
import type { AlertKind } from '../../api/devices'
import { locale, useT } from '../../composables/useT'
import { severityRank, sortBySeverity } from '../../lib/childOrder'
import { lastSeen, LEVEL_ICON, statusLevel } from '../../lib/childStatus'
import { children, loadChildren, selectChild } from '../../store/children'
import { canManage } from '../../store/family'
import ChildAvatar from './ChildAvatar.vue'
import ChildMenu from './ChildMenu.vue'
import PhoneStatus from './PhoneStatus.vue'
import TodayLog from './TodayLog.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'

// Enfants de la famille sur l'accueil (NAR-174) : une carte par enfant, empilées. La carte
// de l'enfant sélectionné est dépliée (« Aujourd'hui ») ; toucher une autre carte la
// sélectionne. « ⋯ » (gestionnaires) : modifier, téléphone, code parent.
// NAR-193 : cartes rangées par gravité (`sortBySeverity`) ; à partir de deux enfants,
// « Aujourd'hui » est replié sur chaque carte et s'ouvre à la demande ; une carte sans
// téléphone propose de le relier (gestionnaires) et n'a pas de journal.
// todayAside : enfant dont « Aujourd'hui » est déjà montré à côté des cartes (ordinateur,
// NAR-223) ; sa carte ne le répète pas.
const props = defineProps<{ todayAside?: string | null }>()
const t = useT()
const router = useRouter()
// Alertes ouvertes lues par PhoneStatus, par enfant (NAR-192) : la pastille en dépend, sans
// second chargement. Absentes ou null tant que l'état n'est pas lu, après un échec ou sans
// relevé : niveau inconnu, pastille réservée.
const alertsFor = reactive<Record<string, AlertKind[] | null>>({})
const level = (c: Child) => statusLevel(c.phoneLastSeenAt, alertsFor[c.id] ?? null)
// Ordre affiché : repart de celui déjà montré (gardé dans le store), un état inconnu garde
// sa place ; aux mêmes états, une relecture ne déplace rien.
// Focus clavier dans la liste : l'ordre affiché est gardé (une carte déplacée perdrait le
// focus, le DOM la réinsère) ; le tri reprend dès que le focus quitte la liste.
const holding = ref(false)
function onFocusIn(e: FocusEvent) {
  try { holding.value = e.target instanceof Element && e.target.matches(':focus-visible') } catch { holding.value = false }
}
function onFocusOut(e: FocusEvent) {
  const list = e.currentTarget as HTMLElement
  if (!(e.relatedTarget instanceof Node && list.contains(e.relatedTarget))) holding.value = false
}
const cards = computed(() => sortBySeverity(
  children.items,
  (c) => (holding.value ? null : severityRank(c.phoneLastSeenAt, alertsFor[c.id] ?? null)),
  children.order
))
watch(() => cards.value.map((c) => c.id).join(','), () => { children.order = cards.value.map((c) => c.id) }, { immediate: true })
// « Aujourd'hui » replié par défaut dès deux enfants ; un seul enfant : déplié s'il est sélectionné.
const collapsible = computed(() => children.items.length > 1)
const openToday = reactive(new Set<string>())
function toggleToday(c: Child) {
  if (openToday.has(c.id)) { openToday.delete(c.id); return }
  openToday.add(c.id)
  // « Tout le journal » ouvre le journal de l'enfant sélectionné : c'est celui-ci.
  selectChild(c.id)
}
const showToday = (c: Child) => Boolean(c.phoneLastSeenAt) && !props.todayAside && (collapsible.value ? openToday.has(c.id) : c.id === children.selectedId)
const menuFor = ref<Child | null>(null)
const menuOpener = ref<HTMLElement | null>(null)
function openMenu(c: Child, e: MouseEvent) {
  menuOpener.value = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
  menuFor.value = c
}
// Enfant retiré entre-temps (relecture) : son menu se ferme, jamais d'action sur un autre.
watch(() => children.items, (items) => { if (menuFor.value && !items.some((c) => c.id === menuFor.value?.id)) menuFor.value = null })
// Heure courante, relue chaque minute : « vu à … aujourd'hui » change de jour à minuit.
const now = ref(new Date())
// « Téléphone vu à … » relu chaque minute tant que l'accueil est ouvert (le téléphone
// passe toutes les minutes ; un retrait par un autre parent se voit aussi).
const timer = setInterval(() => {
  now.value = new Date()
  if (document.visibilityState === 'visible') void loadChildren(true)
}, 60_000)
// Retour au premier plan : relu tout de suite, sans attendre la minute suivante.
const onVisible = () => { if (document.visibilityState === 'visible') { now.value = new Date(); void loadChildren(true) } }
document.addEventListener('visibilitychange', onVisible)
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) })
</script>

<template>
  <ul class="cards" @focusin="onFocusIn" @focusout="onFocusOut">
    <li v-for="c in cards" :key="c.id" class="card child" :class="{ open: c.id === children.selectedId }">
      <div class="head">
        <!-- Prénom en titre (navigation par titres) ; enfant affiché : aria-current. -->
        <h2 class="title">
          <button
            type="button" class="select" :aria-current="c.id === children.selectedId ? 'true' : undefined"
            :aria-controls="!collapsible && showToday(c) ? `today-${c.id}` : undefined" @click="selectChild(c.id)"
          >
            <ChildAvatar :name="c.firstName" :color="c.avatarColor" :size="52" />
            <span class="who">
              <span class="name">{{ c.firstName }}</span>
              <!-- Ligne d'état (NAR-192) : pastille (couleur, icône, texte), puis « vu à … ». -->
              <span class="status">
                <span v-if="level(c)" class="pill" :class="level(c)">
                  <AppIcon :name="LEVEL_ICON[level(c) ?? 'none']" :size="16" />{{ t.children.levels[level(c) ?? 'none'] }}
                </span>
                <!-- Niveau pas encore lu : place de « Tout va bien » gardée, rien n'est annoncé. -->
                <span v-else class="pill ok pending" aria-hidden="true"><AppIcon name="check" :size="16" />{{ t.children.levels.ok }}</span>
                <span v-if="c.phoneLastSeenAt" class="seen">{{ lastSeen(c.phoneLastSeenAt, t, locale, now) }}</span>
              </span>
            </span>
          </button>
        </h2>
        <button v-if="canManage()" type="button" class="more" :aria-label="t.children.actions(c.firstName)" @click="openMenu(c, $event)">
          <AppIcon name="more" :size="22" />
        </button>
      </div>
      <!-- Batterie, réseau, carte SIM et alertes du téléphone (NAR-147), sur chaque carte. -->
      <PhoneStatus v-if="c.phoneLastSeenAt" :child-id="c.id" :name="c.firstName" @alerts="alertsFor[c.id] = $event" />
      <!-- Aucun téléphone (NAR-193) : texte pour tous, « Relier le téléphone » pour les gestionnaires. -->
      <div v-else class="no-phone">
        <p>{{ t.children.noPhoneYet(c.firstName) }}</p>
        <AppButton v-if="canManage()" block @click="router.push({ name: 'telephone', params: { id: c.id } })">
          <AppIcon name="qr" :size="22" />{{ t.children.pairPhone }}
        </AppButton>
      </div>
      <!-- « Antsoy » (NAR-194, maquette écran 6 : sous l'état du téléphone, avant « Aujourd'hui ») :
           lien tel: au style du bouton principal (--call), pour tous les membres, seulement avec un numéro. -->
      <!-- Appeler et Message (NAR-227, maquette 01). Sans numéro, « Appeler » mène à sa saisie
           (gestionnaires, téléphone relié ; sinon « Relier le téléphone » reste la seule action) :
           jamais un bouton sans effet. « Message » ouvre le journal de l'enfant
           filtré sur ses messages rapides. -->
      <div class="actions">
        <a v-if="c.phone" class="btn call" :href="`tel:${c.phone}`" :aria-label="t.children.callChild(c.firstName)">
          <AppIcon name="call" :size="20" />{{ t.children.call }}
        </a>
        <RouterLink
          v-else-if="canManage() && c.phoneLastSeenAt" class="btn call" :to="{ name: 'enfant', params: { id: c.id }, query: { focus: 'phone' } }"
          :aria-label="t.children.addPhoneToCall(c.firstName)"
        >
          <AppIcon name="call" :size="20" />{{ t.children.call }}
        </RouterLink>
        <RouterLink
          v-if="c.phoneLastSeenAt" class="btn btn-soft" :to="{ name: 'journal', query: { kind: 'messages' } }"
          :aria-label="t.children.messageChild(c.firstName)" @click="selectChild(c.id)"
        >
          <AppIcon name="mail" :size="20" />{{ t.children.message }}
        </RouterLink>
      </div>
      <!-- Deux enfants ou plus : « Aujourd'hui » derrière un bouton à aria-expanded. Sur
           ordinateur, le journal de l'enfant choisi est à côté des cartes : pas de bouton. -->
      <h3 v-if="collapsible && c.phoneLastSeenAt && !todayAside" class="today-toggle">
        <button type="button" :aria-expanded="openToday.has(c.id)" :aria-controls="`today-${c.id}`" @click="toggleToday(c)">
          <span>{{ t.parent.log.todayTitle }}</span>
          <AppIcon name="chevron-right" :size="20" class="chevron" />
        </button>
      </h3>
      <TodayLog v-if="showToday(c)" :id="`today-${c.id}`" :child-id="c.id" bare :untitled="collapsible" />
    </li>
    <li v-if="canManage()">
      <RouterLink class="add" :to="{ name: 'enfant-nouveau' }">+ {{ t.children.add }}</RouterLink>
    </li>
  </ul>
  <ChildMenu v-if="menuFor" :child="menuFor" :opener="menuOpener" @close="menuFor = null" />
</template>

<style scoped>
.actions {
  margin: var(--space-3) 0 var(--space-1);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-2);
}
.actions:empty {
  display: none;
}
/* Action secondaire teintée (maquette 01) : fond --accent-soft, encre --accent-deep (≥ 4.5:1). */
.btn-soft {
  background: var(--accent-soft);
  color: var(--accent-deep);
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.child {
  padding: 12px 12px 12px 16px;
  transition: box-shadow 0.15s;
}
/* Carte sélectionnée : bord discret (NAR-192) ; elle se distingue aussi par « Aujourd'hui ». */
.child.open {
  box-shadow: 0 0 0 1px var(--border-strong);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.select {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 14px;
  min-height: 64px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.title {
  flex: 1;
  margin: 0;
  font: inherit;
}
.select {
  width: 100%;
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: 1.35rem;
  font-weight: 900;
  overflow-wrap: anywhere;
}
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  margin-top: 2px;
  color: var(--text-soft);
  font-weight: 700;
  font-size: var(--fs-small);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px 2px 6px;
  border-radius: var(--radius-pill);
  font-weight: 800;
  white-space: nowrap;
}
.pill.ok {
  background: var(--tint-mint);
  color: var(--call);
}
.pill.warn {
  background: var(--warning-bg);
  color: var(--warning-ink);
}
.pill.alert {
  background: color-mix(in srgb, var(--sos) 14%, var(--surface-card));
  color: var(--sos-deep);
}
.pill.none {
  background: var(--surface-muted);
  color: var(--ink-soft);
}
.pill.pending {
  visibility: hidden;
}
.seen {
  white-space: nowrap;
}
.more {
  flex: none;
  width: var(--tap);
  height: var(--tap);
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
}
.no-phone {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-2) 0 var(--space-1);
}
.no-phone p {
  margin: 0;
  color: var(--text-soft);
}
.call,
.btn-soft {
  text-decoration: none;
}
.today-toggle {
  margin: var(--space-2) 0 0;
  border-top: 1px solid var(--border);
  font: inherit;
}
.today-toggle button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: var(--tap);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  font-size: var(--fs-h2);
  font-weight: 900;
  text-align: left;
  cursor: pointer;
}
.today-toggle .chevron {
  transform: rotate(90deg);
  transition: transform 0.15s;
}
.today-toggle button[aria-expanded='true'] .chevron {
  transform: rotate(-90deg);
}
.select:focus-visible,
.more:focus-visible,
.today-toggle button:focus-visible,
.add:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.add {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  border: 2px dashed var(--border-strong);
  border-radius: 20px;
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
</style>
