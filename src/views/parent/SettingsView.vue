<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Child } from '../../api/children'
import AppIcon from '../../components/ui/AppIcon.vue'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import { phoneStatus } from '../../lib/childStatus'
import { canManage } from '../../store/family'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import { useSettingsSummary } from '../../composables/useSettingsSummary'
import { locale, useT } from '../../composables/useT'
import { formatDay } from '../../lib/format'
import { appsSummary, schedulesSummary, sectionTitle, SETTINGS_SECTIONS, sosSummary, templatesSummary, type SettingsSection } from '../../lib/settingsSections'
import { contacts, loadContacts } from '../../store/contacts'
import { summaryVersion } from '../../store/settingsSummary'

// Résumé de Réglages (NAR-185) : une ligne par section (icône, titre, état réel en une
// ligne), qui ouvre sa page. Lectures : celles des cartes, lancées ensemble ; une lecture
// en cours se lit « Chargement… » sur sa ligne, une lecture en échec « Indisponible »,
// avec un seul bandeau « Réessayer » au-dessus des lignes.
const props = defineProps<{ child: Child }>()
const t = useT()
const { state, retry, refresh } = useSettingsSummary(() => props.child.id)
watch(summaryVersion, refresh)

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
            <span class="desc">{{ t.parent.settings.descriptions[r.key] }}</span>
            <span v-if="r.line.status === 'ready'" class="summary" :class="{ warn: r.line.warn }">{{ r.line.text }}</span>
            <span v-else-if="r.line.status === 'error'" class="summary warn">{{ t.parent.settings.unavailable }}</span>
            <span v-else class="summary pending">{{ t.status.loading }}</span>
          </span>
          <AppIcon class="chevron" name="chevron-right" :size="20" />
        </RouterLink>
      </li>
    </ul>
  </nav>
  <!-- Téléphone de l'enfant (NAR-232) : sous les sections (elles tiennent toujours sans défiler à
       360 × 640), son état et, pour un gestionnaire, l'accès à sa configuration. -->
  <section class="phone-card" :aria-label="t.contacts.phoneOf(child.firstName)">
    <ChildAvatar :name="child.firstName" :color="child.avatarColor" :size="44" />
    <span class="text">
      <span class="title">{{ t.contacts.phoneOf(child.firstName) }}</span>
      <span class="summary">{{ phoneStatus(child.phoneLastSeenAt, t, locale) }}</span>
    </span>
    <RouterLink v-if="canManage()" class="btn btn-ghost btn-small phone-link" :to="{ name: 'telephone', params: { id: child.id } }">
      <AppIcon name="smartphone" :size="18" />{{ t.parent.settings.phoneAction }}
    </RouterLink>
  </section>
</template>

<style scoped>
/* Liste des sections (maquette 05, NAR-232) : une seule carte, lignes séparées d'un petit espace,
 * pastille d'icône en carré arrondi ; section ouverte sur fond --accent-soft, pastille blanche. */
.rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: var(--space-2);
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 60px;
  /* 6 px : les six lignes tiennent sans défiler à 360 × 640 (NAR-185). */
  padding: 6px var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text);
  text-decoration: none;
}
/* Section ouverte (maître/détail sur ordinateur, NAR-223) : surlignée ; aria-current la
 * nomme pour un lecteur d'écran (posé par RouterLink). */
.row[aria-current='page'] {
  background: var(--accent-soft);
}
.row[aria-current='page'] .icon {
  background: var(--surface);
  color: var(--accent-deep);
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
  width: 44px;
  height: 44px;
  border-radius: 12px;
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
  line-height: 1.3;
}
/* Ce que règle la section (NAR-232), puis son état. Texte court ; jamais coupé (passe à la
 * ligne si la police est agrandie). */
.desc {
  color: var(--text-soft);
  font-size: var(--fs-small);
  line-height: 1.3;
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
.phone-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
}
.phone-card .text {
  flex: 1 1 160px;
}
.phone-card .summary {
  white-space: normal;
}
/* Bouton sur sa propre ligne, pleine largeur : le texte garde toute la place. */
.phone-link {
  flex: 1 0 100%;
}
.chevron {
  flex: none;
  color: var(--text-soft);
}
</style>
