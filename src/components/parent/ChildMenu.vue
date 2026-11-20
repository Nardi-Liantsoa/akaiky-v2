<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import type { Child } from '../../api/children'
import { useT } from '../../composables/useT'
import { selectChild } from '../../store/children'
import ChildSheet from './ChildSheet.vue'

// Actions d'un enfant (« ⋯ » de sa carte, gestionnaires) : modifier, téléphone (s'il est
// relié), code parent. Fermé par ×, le fond, Échap ou le retour Android (ChildSheet).
const props = defineProps<{ child: Child, opener?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const t = useT()
const router = useRouter()
// Le code parent est dans Réglages, pour l'enfant sélectionné : on le sélectionne d'abord.
async function openParentCode() {
  selectChild(props.child.id)
  emit('close')
  await router.push({ name: 'reglages-code-parent' })
}
</script>

<template>
  <ChildSheet :title="t.children.actions(child.firstName)" :opener="opener" close-icon @close="emit('close')">
    <nav class="menu">
      <RouterLink class="item" :to="{ name: 'enfant', params: { id: child.id } }" @click="emit('close')">{{ t.children.edit }}</RouterLink>
      <!-- Sans téléphone relié (même test que la carte, phoneLastSeenAt), la carte offre déjà
           « Relier le téléphone » : pas de doublon ici (NAR-195). -->
      <RouterLink v-if="child.phoneLastSeenAt" class="item" :to="{ name: 'telephone', params: { id: child.id } }" @click="emit('close')">{{ t.children.phone }}</RouterLink>
      <button class="item" type="button" @click="openParentCode">{{ t.children.parentCode }}</button>
    </nav>
  </ChildSheet>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
}
.item {
  display: flex;
  align-items: center;
  min-height: 56px;
  padding: 0 4px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: none;
  color: var(--text);
  font: inherit;
  font-size: 1.05rem;
  font-weight: 800;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.item:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: -3px;
}
</style>
