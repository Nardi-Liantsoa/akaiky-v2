<script setup lang="ts">
import type { JournalFilter, JournalToday } from '../../api/journal'
import { useT } from '../../composables/useT'
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'

// Tuiles de synthèse du journal (NAR-175, design A) : nombres du jour, et filtres.
// Toucher une tuile filtre la liste ; la retoucher revient à « Tout ». Grille 2 × 2 sur
// téléphone (rien n'est coupé à 320 px), 4 colonnes au-delà.
const props = defineProps<{ modelValue: JournalFilter, today: JournalToday | null }>()
const emit = defineEmits<{ 'update:modelValue': [JournalFilter] }>()
const t = useT()
const TILES = ['calls', 'blocked', 'messages', 'unlocks'] as const
// Une icône par tuile (NAR-231), mêmes icônes que les lignes du journal.
const ICONS: Record<typeof TILES[number], IconName> = { calls: 'phone', blocked: 'blocked', messages: 'mail', unlocks: 'unlock' }
const toggle = (key: JournalFilter) => emit('update:modelValue', props.modelValue === key ? 'all' : key)
</script>

<template>
  <section class="summary-block">
    <!-- Les nombres sont ceux du jour ; une tuile touchée filtre tout le journal. -->
    <h2 id="log-summary-title" class="visually-hidden">{{ t.parent.log.summaryTitle }}</h2>
    <p id="log-summary-help" class="visually-hidden">{{ t.parent.log.summary.label }}</p>
    <div class="summary" role="group" aria-labelledby="log-summary-title" aria-describedby="log-summary-help">
      <button
        v-for="key in TILES" :key="key" type="button" class="tile" :class="key"
        :aria-pressed="modelValue === key" @click="toggle(key)"
      >
        <span class="tile-icon" aria-hidden="true"><AppIcon :name="ICONS[key]" :size="22" /></span>
        <span class="text">
          <span class="count" :class="{ alert: key === 'blocked' && today && today.blocked > 0 }">{{ today ? today[key] : '–' }}</span>
          <span class="label">{{ t.parent.log.summary[key] }}</span>
        </span>
        <AppIcon v-if="modelValue === key" class="on" name="check" :size="18" />
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 72px;
  padding: 12px;
  border: 2px solid transparent;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
/* Pastilles teintées : les mêmes que les icônes des lignes du journal (LogItem). */
.tile-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
}
.calls .tile-icon { background: var(--tint-sky); }
.blocked .tile-icon { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
.messages .tile-icon { background: var(--tint-mint); }
.unlocks .tile-icon { background: var(--tint-butter); }
.text {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
/* Tuile active : bord d'accent et coche (jamais la couleur seule). */
.tile[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.on {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--accent-deep);
}
.tile:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
.count {
  font-size: 1.5rem;
  font-weight: 900;
  line-height: 1.1;
}
.count.alert {
  color: var(--danger);
}
.label {
  color: var(--text-soft);
  font-weight: 800;
  font-size: 0.88rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
</style>
