<script setup lang="ts">
import type { JournalFilter } from '../../api/journal'
import { useT } from '../../composables/useT'

// Filtres du journal (maquette écran 9) : Tout · Appels · Bloqués (avec compte) · Messages.
// SOS et alertes s'ajouteront avec leurs tickets (NAR-149, NAR-147).
defineProps<{ modelValue: JournalFilter, blocked: number | null }>()
const emit = defineEmits<{ 'update:modelValue': [JournalFilter] }>()
const t = useT()
const FILTERS: JournalFilter[] = ['all', 'calls', 'blocked', 'messages']
</script>

<template>
  <div class="filters" role="group" :aria-label="t.parent.log.filters.label">
    <button
      v-for="f in FILTERS" :key="f" type="button" class="chip" :aria-pressed="f === modelValue"
      @click="emit('update:modelValue', f)"
    >
      {{ f === 'blocked' ? (blocked === null ? t.parent.log.filters.blockedPlain : t.parent.log.filters.blocked(blocked)) : t.parent.log.filters[f] }}
    </button>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0 6px;
  scrollbar-width: none;
}
.chip {
  flex: none;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 800;
  white-space: nowrap;
}
.chip[aria-pressed='true'] {
  border-color: var(--text);
  background: var(--text);
  color: var(--bg);
}
.chip:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
