<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Child } from '../../api/children'
import { locale, useT } from '../../composables/useT'
import { phoneStatus } from '../../lib/childStatus'
import { children, loadChildren, selectChild } from '../../store/children'
import { canManage } from '../../store/family'
import ChildAvatar from './ChildAvatar.vue'
import ChildMenu from './ChildMenu.vue'
import PhoneStatus from './PhoneStatus.vue'
import TodayLog from './TodayLog.vue'

// Enfants de la famille sur l'accueil (NAR-174) : une carte par enfant, empilées. La carte
// de l'enfant sélectionné est dépliée (« Aujourd'hui ») ; toucher une autre carte la
// sélectionne. « ⋯ » (gestionnaires) : modifier, téléphone, code parent.
const t = useT()
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
              <span class="status" :class="{ none: !c.phoneLastSeenAt }">{{ phoneStatus(c.phoneLastSeenAt, t, locale, now) }}</span>
            </span>
          </button>
        </h2>
        <button v-if="canManage()" type="button" class="more" :aria-label="t.children.actions(c.firstName)" @click="openMenu(c, $event)">⋯</button>
      </div>
      <!-- Batterie, réseau, carte SIM et alertes du téléphone (NAR-147), sur chaque carte. -->
      <PhoneStatus v-if="c.phoneLastSeenAt" :child-id="c.id" :name="c.firstName" />
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
.child.open {
  box-shadow: 0 0 0 2px var(--ink);
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
  color: var(--text-soft);
  font-weight: 700;
  font-size: 0.92rem;
}
.status.none {
  color: var(--ink-mute);
}
.more {
  flex: none;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 1.3rem;
  font-weight: 900;
  line-height: 1;
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
