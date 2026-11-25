<script setup lang="ts">
import { useT } from '../../composables/useT'
import type { AppTile } from '../../lib/appInventory'

// Rangée d'applications de l'accueil enfant (NAR-143) : les applications autorisées par le
// parent. Les messages rapides ont leur propre bouton, « Dire à mes parents » (NAR-237).
defineProps<{ apps: AppTile[] }>()
const emit = defineEmits<{ launch: [pkg: string] }>()
const t = useT()
</script>

<template>
  <nav class="apps" :aria-label="t.child.apps.label">
    <button v-for="a in apps" :key="a.package" class="tile" type="button" :aria-label="t.child.apps.open(a.label)" @click="emit('launch', a.package)">
      <img v-if="a.icon" class="icon" :src="`data:image/png;base64,${a.icon}`" alt="" width="40" height="40">
      <span v-else class="glyph" aria-hidden="true">{{ [...a.label][0] }}</span>
      <span class="name">{{ a.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.apps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 10px;
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 88px;
  padding: 10px 6px;
  border: 0;
  border-radius: 20px;
  background: var(--surface-card);
  color: var(--ink);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.icon {
  width: 40px;
  height: 40px;
}
.glyph {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--surface-muted);
  font-size: 1.3rem;
  font-weight: 900;
}
.name {
  max-width: 100%;
  overflow: hidden;
  font-size: 0.85rem;
  line-height: 1.15;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tile:focus-visible {
  outline: 3px solid var(--call);
  outline-offset: 2px;
}
</style>
