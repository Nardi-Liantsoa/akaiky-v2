<script setup lang="ts">
import type { JournalFilter, JournalToday } from '../../api/journal'
import { useT } from '../../composables/useT'

// Tuiles de synthèse du journal (NAR-175, design A) : nombres du jour, et filtres.
// Toucher une tuile filtre la liste ; la retoucher revient à « Tout ». Grille 2 × 2 sur
// téléphone (rien n'est coupé à 320 px), 4 colonnes au-delà.
const props = defineProps<{ modelValue: JournalFilter, today: JournalToday | null }>()
const emit = defineEmits<{ 'update:modelValue': [JournalFilter] }>()
const t = useT()
const TILES = ['calls', 'blocked', 'messages', 'unlocks'] as const
const toggle = (key: JournalFilter) => emit('update:modelValue', props.modelValue === key ? 'all' : key)
</script>

<template>
  <section class="summary-block">
    <!-- Les nombres sont ceux du jour ; une tuile touchée filtre tout le journal. -->
    <h2 id="log-summary-title" class="caption">{{ t.parent.log.summaryTitle }}</h2>
    <p id="log-summary-help" class="visually-hidden">{{ t.parent.log.summary.label }}</p>
    <div class="summary" role="group" aria-labelledby="log-summary-title" aria-describedby="log-summary-help">
      <button
        v-for="key in TILES" :key="key" type="button" class="tile" :class="key"
        :aria-pressed="modelValue === key" @click="toggle(key)"
      >
        <span class="count">{{ today ? today[key] : '–' }}</span>
        <span class="label">{{ t.parent.log.summary[key] }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.caption {
  margin: 0 0 6px;
  color: var(--text-soft);
  font-size: 0.9rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
@media (min-width: 560px) {
  .summary {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-height: 72px;
  padding: 10px 12px;
  border: 2px solid transparent;
  border-radius: 16px;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.calls { background: var(--tint-sky); }
.blocked { background: color-mix(in srgb, var(--danger) 14%, var(--surface)); }
.messages { background: var(--tint-mint); }
.unlocks { background: var(--tint-butter); }
.tile[aria-pressed='true'] {
  border-color: var(--ink);
}
.tile:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.count {
  font-size: 1.6rem;
  font-weight: 900;
  line-height: 1.1;
}
.label {
  font-weight: 800;
  font-size: 0.92rem;
  overflow-wrap: anywhere;
}
</style>
