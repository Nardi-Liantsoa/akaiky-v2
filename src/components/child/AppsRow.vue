<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useT } from '../../composables/useT'
import type { AppTile } from '../../lib/appInventory'
import AppIcon from '../ui/AppIcon.vue'

// Rangée d'applications de l'accueil enfant (NAR-143) : les applications autorisées par le
// parent, en petites icônes de 46 px (planche 03, NAR-238 : la famille passe d'abord). Au-delà de
// 3, une 4e case « Plus » montre les autres. Les messages rapides ont leur bouton (NAR-237).
const props = defineProps<{ apps: AppTile[] }>()
const emit = defineEmits<{ launch: [pkg: string] }>()
const t = useT()
const SHOWN = 3
const open = ref(false)
const visible = computed(() => (open.value || props.apps.length <= SHOWN ? props.apps : props.apps.slice(0, SHOWN)))
const hasMore = computed(() => props.apps.length > SHOWN && !open.value)
const row = ref<HTMLElement | null>(null)
// « Plus » disparaît : le focus passe à la première application montrée en plus.
async function more() {
  open.value = true
  await nextTick()
  row.value?.querySelectorAll<HTMLButtonElement>('.app')[SHOWN]?.focus()
}
</script>

<template>
  <nav ref="row" class="apps" :aria-label="t.child.apps.label">
    <button v-for="a in visible" :key="a.package" class="app" type="button" :aria-label="t.child.apps.open(a.label)" @click="emit('launch', a.package)">
      <span class="box" aria-hidden="true">
        <img v-if="a.icon" :src="`data:image/png;base64,${a.icon}`" alt="" width="32" height="32">
        <span v-else class="glyph">{{ [...a.label][0] }}</span>
      </span>
      <span class="name">{{ a.label }}</span>
    </button>
    <button v-if="hasMore" class="app" type="button" :aria-label="t.child.apps.moreLabel" @click="more">
      <span class="box" aria-hidden="true"><AppIcon name="more" :size="22" /></span>
      <span class="name">{{ t.child.apps.more }}</span>
    </button>
  </nav>
</template>

<style scoped>
.apps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-height: var(--tap-child);
  padding: 4px 2px;
  border: 0;
  border-radius: 14px;
  background: none;
  color: var(--text-soft);
  font: inherit;
  cursor: pointer;
}
.app:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
.box {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--border);
  color: var(--text-soft);
}
.glyph {
  font-size: 1.2rem;
  font-weight: 900;
  color: var(--ink);
}
.name {
  max-width: 100%;
  overflow: hidden;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
