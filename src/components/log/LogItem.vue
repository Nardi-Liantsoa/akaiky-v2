<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { JournalItem } from '../../api/journal'
import { useT } from '../../composables/useT'
import { formatClock } from '../../lib/format'
import { formatPhone, isE164 } from '../../lib/phone'
import { QUICK_TINT } from '../../lib/quickMessages'
import QuickIcon from '../messages/QuickIcon.vue'

// Une ligne du journal (NAR-152, maquette écran 9). Appel bloqué : « Autoriser » ouvre
// l'ajout d'un contact pré-rempli avec le numéro (gestionnaires seulement, numéro connu).
const props = defineProps<{ item: JournalItem, childId: string, canAllow: boolean }>()
const t = useT()

const time = computed(() => formatClock(new Date(props.item.at)))
const duration = (s: number | null) => {
  if (s === null) return ''
  if (s === 0) return t.value.parent.log.unanswered
  return t.value.parent.log.duration(Math.floor(s / 60), s % 60)
}
const view = computed(() => {
  const i = props.item
  const log = t.value.parent.log
  switch (i.kind) {
    case 'call_out': return { tone: 'call', title: log.callOut(i.name ?? (i.phone ? formatPhone(i.phone) : log.unknownContact)), detail: duration(i.durationS) }
    case 'call_in': return { tone: 'call', title: log.callIn(i.name ?? (i.phone ? formatPhone(i.phone) : log.unknownContact)), detail: duration(i.durationS) }
    case 'call_blocked': return { tone: 'blocked', title: log.blocked, detail: `${i.phone ? formatPhone(i.phone) : log.hiddenNumber} · ${log.notRung}` }
    case 'unlock': return { tone: 'unlock', title: i.source === 'remote' ? log.unlockRemote : log.unlockCode, detail: i.durationS ? log.unlockFor(Math.max(1, Math.round(i.durationS / 60))) : '' }
    default: return { tone: 'message', title: t.value.child.quick.texts[i.slot - 1], detail: i.readBy.length ? t.value.parent.home.seenBy(i.readBy.map((r) => r.name).join(', ')) : '' }
  }
})
// Seul un numéro E.164 complet peut devenir un contact (même règle que le formulaire) ;
// un numéro masqué ou un numéro court, jamais.
const allowPhone = computed(() => (props.canAllow && props.item.kind === 'call_blocked' && isE164(props.item.phone) ? props.item.phone : null))
</script>

<template>
  <li class="item" :class="view.tone">
    <span class="icon" aria-hidden="true" :style="item.kind === 'message' ? { background: QUICK_TINT[item.slot] } : undefined">
      <QuickIcon v-if="item.kind === 'message'" :kind="item.slot" :size="24" />
      <svg v-else viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <template v-if="item.kind === 'call_blocked'"><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></template>
        <template v-else-if="item.kind === 'unlock'"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></template>
        <path v-else d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
      </svg>
    </span>
    <span class="body">
      <span class="title">{{ view.title }}</span>
      <span v-if="view.detail" class="detail" data-selectable>{{ view.detail }}</span>
    </span>
    <span class="side">
      <time :datetime="item.at">{{ time }}</time>
    </span>
    <!-- Appel bloqué : la décision du parent, sur toute la largeur (NAR-175). -->
    <RouterLink v-if="allowPhone" class="btn allow" :to="{ name: 'contact-nouveau', params: { childId }, query: { phone: allowPhone } }">{{ t.parent.log.allowNumber }}</RouterLink>
  </li>
</template>

<style scoped>
.item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--tint-sky);
  color: var(--text);
}
.blocked .icon {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}
.unlock .icon {
  background: var(--tint-butter);
}
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.title {
  font-weight: 800;
  overflow-wrap: anywhere;
}
.detail {
  color: var(--text-soft);
  font-size: 0.92rem;
  font-weight: 600;
}
.side {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  color: var(--text-soft);
  font-weight: 700;
}
.blocked {
  padding-left: 10px;
  padding-right: 10px;
  border-left: 4px solid var(--danger);
  background: color-mix(in srgb, var(--danger) 6%, transparent);
}
.allow {
  flex: 1 0 100%;
  margin-top: 4px;
  text-align: center;
}
.allow:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
