<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { Child } from '../../api/children'
import AppIcon from '../../components/ui/AppIcon.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { useSettingsSummary } from '../../composables/useSettingsSummary'
import { locale, useT } from '../../composables/useT'
import { formatDay } from '../../lib/format'
import { appsSummary, schedulesSummary, sectionTitle, SETTINGS_SECTIONS, sosSummary, templatesSummary, type SettingsSection } from '../../lib/settingsSections'
import { contacts, loadContacts } from '../../store/contacts'

// Résumé de Réglages (NAR-185) : une ligne par section (icône, titre, état réel en une
// ligne), qui ouvre sa page. Lectures : celles des cartes, lancées ensemble ; une lecture
// en cours se lit « Chargement… » sur sa ligne, une lecture en échec « Indisponible »,
// avec un seul bandeau « Réessayer » au-dessus des lignes.
const props = defineProps<{ child: Child }>()
const t = useT()
const { state, retry } = useSettingsSummary(() => props.child.id)

type Line = { status: 'loading' | 'ready' | 'error', text: string, warn?: boolean }
const contactsLine = computed<Line>(() => {
  if (contacts.childId !== props.child.id) return { status: 'loading', text: '' }
  // Relecture en échec, liste connue : son nombre reste juste à cette lecture près.
  if (contacts.status === 'ready') return { status: 'ready', text: t.value.contacts.count(contacts.items.length, contacts.max) }
  return { status: contacts.status === 'error' ? 'error' : 'loading', text: '' }
})
const fromState = <T,>(s: { status: string, data: T | null }, text: (d: T) => string): Line =>
  (s.status === 'ready' && s.data !== null ? { status: 'ready', text: text(s.data) } : { status: s.status === 'error' ? 'error' : 'loading', text: '' })

const lines = computed<Record<SettingsSection, Line>>(() => ({
  contacts: contactsLine.value,
  apps: fromState(state.apps, (d) => appsSummary(d, t.value)),
  parentCode: props.child.parentCodeSetAt
    ? { status: 'ready', text: t.value.parent.settings.summary.codeSet(formatDay(props.child.parentCodeSetAt, locale.value)) }
    : { status: 'ready', text: t.value.parent.settings.summary.codeNotSet, warn: true },
  schedules: fromState(state.schedules, (d) => schedulesSummary(d, t.value)),
  sos: { status: 'ready', text: sosSummary(props.child.sosSiren, t.value) },
  templates: fromState(state.templates, (d) => templatesSummary(d, t.value))
}))
const rows = computed(() => SETTINGS_SECTIONS.map((s) => ({ ...s, title: sectionTitle(s.key, t.value), line: lines.value[s.key] })))
const busy = computed(() => rows.value.some((r) => r.line.status === 'loading'))
const failed = computed(() => rows.value.filter((r) => r.line.status === 'error'))

function retryAll() {
  if (contactsLine.value.status === 'error') void loadContacts(props.child.id, true)
  retry()
}
</script>

<template>
  <StatusBlock
    v-if="failed.length" state="error"
    :text="t.parent.settings.summaryError(failed.map((r) => r.title).join(', '))" @retry="retryAll"
  />
  <nav :aria-label="t.parent.settings.sectionsLabel">
    <ul class="rows card" :aria-busy="busy">
      <li v-for="r in rows" :key="r.key">
        <RouterLink class="row" :to="{ name: r.route }">
          <span class="icon" aria-hidden="true"><AppIcon :name="r.icon" /></span>
          <span class="text">
            <span class="title">{{ r.title }}</span>
            <span v-if="r.line.status === 'ready'" class="summary" :class="{ warn: r.line.warn }">{{ r.line.text }}</span>
            <span v-else-if="r.line.status === 'error'" class="summary warn">{{ t.parent.settings.unavailable }}</span>
            <span v-else class="summary pending">{{ t.status.loading }}</span>
          </span>
          <AppIcon class="chevron" name="chevron-right" :size="20" />
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.rows {
  margin: 0;
  padding: var(--space-1) var(--space-4);
  list-style: none;
}
.rows li + li {
  border-top: 1px solid var(--border);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: var(--space-2) 0;
  color: var(--text);
  text-decoration: none;
}
.row:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
  border-radius: var(--space-2);
}
.icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--ink);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.title {
  font-weight: 800;
}
/* Une ligne : un résumé long (noms d'applications) s'arrête sur « … ». */
.summary {
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--fs-small);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary.warn {
  color: var(--danger);
}
.summary.pending {
  font-weight: 600;
}
.chevron {
  flex: none;
  color: var(--text-soft);
}
</style>
