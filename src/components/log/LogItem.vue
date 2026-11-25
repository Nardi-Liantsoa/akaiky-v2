<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { JournalItem } from '../../api/journal'
import { useT } from '../../composables/useT'
import { formatClock } from '../../lib/format'
import { formatPhone, isE164 } from '../../lib/phone'
import { QUICK_TINT, quickText } from '../../lib/quickMessages'
import QuickIcon from '../messages/QuickIcon.vue'
import AppIcon from '../ui/AppIcon.vue'

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
    // Laissé sonner par la fenêtre des secours (NAR-196) : inconnu ou masqué, marqué comme tel.
    case 'call_in': return i.emergencyWindow
      ? { tone: 'call', title: log.callIn(i.name ?? (i.phone ? formatPhone(i.phone) : log.hiddenNumber)), detail: [log.emergencyWindow, duration(i.durationS)].filter(Boolean).join(' · ') }
      : { tone: 'call', title: log.callIn(i.name ?? (i.phone ? formatPhone(i.phone) : log.unknownContact)), detail: duration(i.durationS) }
    // Contact connu (nom) : bloqué pendant une plage « école » (NAR-176).
    case 'call_blocked': return i.name
      ? { tone: 'blocked', title: log.blockedContact(i.name), detail: `${log.duringSchedule} · ${log.notRung}` }
      // Numéro à part, jamais coupé (NAR-231) : à 360 px, « n'a pas sonné » passe à la ligne, pas lui.
      : { tone: 'blocked', title: log.blocked, number: i.phone ? formatPhone(i.phone) : '', detail: i.phone ? log.notRung : `${log.hiddenNumber} · ${log.notRung}` }
    case 'unlock': return { tone: 'unlock', title: i.source === 'remote' ? log.unlockRemote : log.unlockCode, detail: i.durationS ? log.unlockFor(Math.max(1, Math.round(i.durationS / 60))) : '' }
    default: return { tone: 'message', title: quickText(i.slot, t.value.child.quick.texts, i.text), detail: i.readBy.length ? t.value.parent.home.seenBy(i.readBy.map((r) => r.name).join(', ')) : '' }
  }
})
// Seul un numéro E.164 complet peut devenir un contact (même règle que le formulaire) ;
// un numéro masqué ou un numéro court, jamais.
// « Autoriser » : pas pour un contact encore dans la liste (bloqué pendant une plage) ; de
// nouveau proposé s'il a été retiré depuis (contactId effacé, nom gardé).
const allowPhone = computed(() => (props.canAllow && props.item.kind === 'call_blocked' && !props.item.contactId && isE164(props.item.phone) ? props.item.phone : null))
</script>

<template>
  <li class="item" :class="view.tone">
    <span class="icon" aria-hidden="true" :style="item.kind === 'message' ? { background: QUICK_TINT[item.slot] } : undefined">
      <QuickIcon v-if="item.kind === 'message'" :kind="item.slot" :size="24" />
      <AppIcon v-else :name="item.kind === 'call_blocked' ? 'blocked' : item.kind === 'unlock' ? 'unlock' : 'phone'" />
    </span>
    <span class="body">
      <span class="title">{{ view.title }}</span>
      <span v-if="view.detail" class="detail" data-selectable><template v-if="'number' in view && view.number"><span class="number">{{ view.number }}</span>{{ ` · ${view.detail}` }}</template><template v-else>{{ view.detail }}</template></span>
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
.number {
  white-space: nowrap;
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
/* Appel bloqué (NAR-231) : l'heure en haut à droite, à hauteur du titre ; la ligne du numéro
   prend toute la largeur et ne se coupe jamais, même à 320 px. */
.blocked {
  position: relative;
  padding-left: 10px;
  padding-right: 10px;
  border-left: 4px solid var(--danger);
  background: color-mix(in srgb, var(--danger) 6%, transparent);
}
.blocked .side {
  position: absolute;
  top: 12px;
  right: 10px;
}
.blocked .title {
  padding-right: 56px;
}
.allow {
  flex: 1 0 100%;
  margin-top: 4px;
  text-align: center;
  /* Action teintée (maquette 02, NAR-227) : fond --accent-soft, encre --accent-deep (≥ 4.5:1). */
  background: var(--accent-soft);
  color: var(--accent-deep);
  text-decoration: none;
}
.allow:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
</style>
