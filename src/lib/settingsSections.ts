import type { ChildApps } from '../api/apps'
import type { MessageTemplate } from '../api/messages'
import type { Schedule } from '../api/schedules'
import type { IconName } from '../components/ui/icons'
import type { Messages } from '../i18n/messages'
import { clock, daysSummary } from './schedule'

// Sections de Réglages (NAR-185) : une ligne du résumé, une page chacune, dans l'ordre
// de l'ancienne page. `route` : nom de la route de la page (src/router.ts).
export const SETTINGS_SECTIONS = [
  { key: 'contacts', route: 'reglages-contacts', path: 'contacts', icon: 'users' },
  { key: 'apps', route: 'reglages-applications', path: 'applications', icon: 'grid' },
  { key: 'parentCode', route: 'reglages-code-parent', path: 'code-parent', icon: 'unlock' },
  { key: 'schedules', route: 'reglages-plages', path: 'plages', icon: 'clock' },
  { key: 'sos', route: 'reglages-sos', path: 'sos', icon: 'siren' },
  { key: 'templates', route: 'reglages-messages', path: 'messages', icon: 'mail' }
] as const satisfies readonly { key: string, route: string, path: string, icon: IconName }[]

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['key']

// Titre d'une section : celui de sa carte.
export function sectionTitle(key: SettingsSection, t: Messages): string {
  switch (key) {
    case 'contacts': return t.contacts.title
    case 'apps': return t.allowedApps.title
    case 'parentCode': return t.parentCode.title
    case 'schedules': return t.schedules.title
    case 'sos': return t.sosSettings.title
    case 'templates': return t.templates.title
  }
}

// Résumés d'une ligne, calculés sur les réponses des API existantes.
export const appsSummary = (apps: ChildApps, t: Messages): string => {
  if (!apps.allowed.length) return apps.inventory.length ? t.parent.settings.summary.noApps : t.parent.settings.summary.noInventory
  return t.parent.settings.summary.apps(t.allowedApps.count(apps.allowed.length, apps.max), apps.allowed.map((a) => a.label).join(', '))
}

// Première plage active (par heure de début), et le nombre des autres actives.
export function schedulesSummary(list: readonly Schedule[], t: Messages): string {
  const s = t.parent.settings.summary
  if (!list.length) return s.noSchedule
  const on = [...list].filter((x) => x.enabled).sort((a, b) => a.startMin - b.startMin)
  if (!on.length) return s.schedulesOff(list.length)
  const first = on[0]
  const text = s.schedule(first.label, daysSummary(first.days, t.schedules.days, t.schedules.everyDay), clock(first.startMin), clock(first.endMin))
  return on.length > 1 ? s.scheduleMore(text, on.length - 1) : text
}

export function templatesSummary(list: readonly MessageTemplate[], t: Messages): string {
  const custom = list.filter((m) => m.text !== null).length
  return custom ? t.parent.settings.summary.templatesCustom(custom, 4) : t.parent.settings.summary.templatesDefault
}

export const sosSummary = (siren: boolean, t: Messages): string =>
  (siren ? t.parent.settings.summary.sirenOn : t.parent.settings.summary.sirenOff)
