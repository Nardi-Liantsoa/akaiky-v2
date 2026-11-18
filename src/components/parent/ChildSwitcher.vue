<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { locale, useT } from '../../composables/useT'
import { phoneStatus } from '../../lib/childStatus'
import { children, selectChild, selectedChild } from '../../store/children'
import { canManage } from '../../store/family'
import ChildAvatar from './ChildAvatar.vue'
import ChildSheet from './ChildSheet.vue'

// Sélecteur compact (Journal, Réglages ; NAR-174) : « (F) Fy ▾ » ouvre la liste des
// enfants avec l'état de leur téléphone. Même sélection que l'accueil.
const t = useT()
const open = ref(false)
const opener = ref<HTMLElement | null>(null)
function show(e: MouseEvent) {
  opener.value = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
  open.value = true
}
const current = computed(selectedChild)
function pick(id: string) {
  selectChild(id)
  open.value = false
}
</script>

<template>
  <button v-if="current" type="button" class="switch" :aria-label="t.children.switchLabel(current.firstName)" aria-haspopup="dialog" @click="show">
    <ChildAvatar :name="current.firstName" :color="current.avatarColor" :size="32" />
    <span class="name">{{ current.firstName }}</span>
    <span aria-hidden="true">▾</span>
  </button>
  <ChildSheet v-if="open" :title="t.children.pickerLabel" :opener="opener" @close="open = false">
    <ul class="list">
      <li v-for="c in children.items" :key="c.id">
        <button type="button" class="row" :aria-pressed="c.id === children.selectedId" @click="pick(c.id)">
          <ChildAvatar :name="c.firstName" :color="c.avatarColor" :size="40" />
          <span class="who">
            <span class="name">{{ c.firstName }}</span>
            <span class="status">{{ phoneStatus(c.phoneLastSeenAt, t, locale) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <RouterLink v-if="canManage()" class="add" :to="{ name: 'enfant-nouveau' }" @click="open = false">+ {{ t.children.add }}</RouterLink>
  </ChildSheet>
</template>

<style scoped>
.switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: var(--tap);
  margin-bottom: 12px;
  padding: 6px 16px 6px 6px;
  border: 1.5px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.name {
  font-weight: 900;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 8px 4px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row[aria-pressed='true'] .name::after {
  content: ' ✓';
}
.who {
  display: flex;
  flex-direction: column;
}
.status {
  color: var(--text-soft);
  font-size: 0.92rem;
  font-weight: 700;
}
.add {
  display: block;
  margin-top: 12px;
  color: var(--accent);
  font-weight: 800;
  text-decoration: none;
}
.switch:focus-visible,
.row:focus-visible,
.add:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
