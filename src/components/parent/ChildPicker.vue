<script setup lang="ts">
import { RouterLink } from 'vue-router'
import ChildAvatar from './ChildAvatar.vue'
import { useT } from '../../composables/useT'
import { children, selectChild } from '../../store/children'
import { canManage } from '../../store/family'

const t = useT()
</script>

<template>
  <div class="picker" role="group" :aria-label="t.children.pickerLabel">
    <button v-for="c in children.items" :key="c.id" type="button" class="chip" :aria-pressed="c.id === children.selectedId" @click="selectChild(c.id)">
      <ChildAvatar :name="c.firstName" :color="c.avatarColor" :size="32" />
      <span class="name">{{ c.firstName }}</span>
    </button>
    <RouterLink v-if="canManage()" class="chip add" :to="{ name: 'enfant-nouveau' }" :aria-label="t.children.add" :title="t.children.add">+</RouterLink>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 6px;
  scrollbar-width: none;
}
.chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 6px 16px 6px 6px;
  border: 1.5px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  text-decoration: none;
}
/* Puce choisie : fond foncé, comme la maquette. */
.chip[aria-pressed='true'] {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--on-color);
}
.chip:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.add {
  justify-content: center;
  width: var(--tap);
  padding: 0;
  font-size: 1.5rem;
  font-weight: 700;
}
.name {
  max-width: 12ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
