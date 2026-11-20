<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Child } from '../../api/children'
import type { AlertKind } from '../../api/devices'
import { locale, useT } from '../../composables/useT'
import { lastSeen, LEVEL_ICON, statusLevel } from '../../lib/childStatus'
import { children, loadChildren, selectChild } from '../../store/children'
import { canManage } from '../../store/family'
import ChildAvatar from './ChildAvatar.vue'
import ChildMenu from './ChildMenu.vue'
import PhoneStatus from './PhoneStatus.vue'
import TodayLog from './TodayLog.vue'
import AppIcon from '../ui/AppIcon.vue'

// Enfants de la famille sur l'accueil (NAR-174) : une carte par enfant, empilées. La carte
// de l'enfant sélectionné est dépliée (« Aujourd'hui ») ; toucher une autre carte la
// sélectionne. « ⋯ » (gestionnaires) : modifier, téléphone, code parent.
const t = useT()
// Alertes ouvertes lues par PhoneStatus, par enfant (NAR-192) : la pastille en dépend, sans
// second chargement. Absentes ou null tant que l'état n'est pas lu, après un échec ou sans
// relevé : niveau inconnu, pastille réservée.
const alertsFor = reactive<Record<string, AlertKind[] | null>>({})
const level = (c: Child) => statusLevel(c.phoneLastSeenAt, alertsFor[c.id] ?? null)
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
  <ul class="cards">
    <li v-for="c in children.items" :key="c.id" class="card child" :class="{ open: c.id === children.selectedId }">
      <div class="head">
        <!-- Prénom en titre (navigation par titres) ; enfant affiché : aria-current. -->
        <h2 class="title">
          <button
            type="button" class="select" :aria-current="c.id === children.selectedId ? 'true' : undefined"
            :aria-controls="c.id === children.selectedId ? `today-${c.id}` : undefined" @click="selectChild(c.id)"
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
      <TodayLog v-if="c.id === children.selectedId" :id="`today-${c.id}`" :child-id="c.id" bare />
    </li>
    <li v-if="canManage()">
      <RouterLink class="add" :to="{ name: 'enfant-nouveau' }">+ {{ t.children.add }}</RouterLink>
    </li>
  </ul>
  <ChildMenu v-if="menuFor" :child="menuFor" :opener="menuOpener" @close="menuFor = null" />
</template>

<style scoped>
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
.select:focus-visible,
.more:focus-visible,
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
