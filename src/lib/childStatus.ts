import type { AlertKind } from '../api/devices'
import type { Messages, Locale } from '../i18n/messages'
import { formatClock, formatDay } from './format'
import { dayKey } from './groupByDay'

// Ligne d'état de la carte d'un enfant sur l'accueil parent (NAR-192) : une pastille à
// quatre niveaux (couleur, icône et texte), puis l'heure du dernier passage du téléphone.
//   ok    : téléphone relié, aucune alerte ouverte (« Tout va bien ») ;
//   warn  : batterie faible ou carte SIM absente ;
//   alert : le téléphone ne répond plus (silence) ;
//   none  : aucun téléphone relié.
export type StatusLevel = 'ok' | 'warn' | 'alert' | 'none'

export const LEVEL_ICON = { ok: 'check', warn: 'warning', alert: 'cross', none: 'blocked' } as const satisfies Record<StatusLevel, string>

const seenDate = (lastSeenAt: string | null): Date | null => {
  if (!lastSeenAt) return null
  const seen = new Date(lastSeenAt)
  return Number.isNaN(seen.getTime()) ? null : seen
}

// Niveau tiré des alertes ouvertes du téléphone (composant PhoneStatus). `alerts` null :
// état pas encore lu (chargement ou échec), le niveau n'est pas connu (null), jamais deviné.
export function statusLevel(lastSeenAt: string | null, alerts: readonly AlertKind[] | null): StatusLevel | null {
  if (!seenDate(lastSeenAt)) return 'none'
  if (!alerts) return null
  if (alerts.includes('silent')) return 'alert'
  if (alerts.includes('battery_low') || alerts.includes('sim_absent')) return 'warn'
  return 'ok'
}

// Dernier passage du téléphone : aujourd'hui l'heure, sinon la date et l'heure ; l'année
// est ajoutée si elle diffère (un téléphone éteint depuis longtemps se voit).
function seenText(seen: Date, iso: string, locale: Locale, now: Date, today: (time: string) => string, other: (day: string, time: string) => string): string {
  const seenKey = dayKey(seen), nowKey = dayKey(now)
  if (seenKey === nowKey) return today(formatClock(seen))
  const day = formatDay(iso, locale) + (seenKey.slice(0, 4) === nowKey.slice(0, 4) ? '' : ` ${seenKey.slice(0, 4)}`)
  return other(day, formatClock(seen))
}

// Sélecteur d'enfant (NAR-174) : « Téléphone vu à 14:05 », « Aucun téléphone relié ».
export function phoneStatus(lastSeenAt: string | null, t: Messages, locale: Locale, now: Date = new Date()): string {
  const seen = seenDate(lastSeenAt)
  if (!seen || !lastSeenAt) return t.children.noPhone
  return seenText(seen, lastSeenAt, locale, now, t.children.seenToday, t.children.seenOn)
}

// Ligne d'état de la carte (NAR-192), après la pastille : « vu à 14:05 » ; rien sans
// téléphone (la pastille « Aucun téléphone » suffit).
export function lastSeen(lastSeenAt: string | null, t: Messages, locale: Locale, now: Date = new Date()): string {
  const seen = seenDate(lastSeenAt)
  if (!seen || !lastSeenAt) return ''
  return seenText(seen, lastSeenAt, locale, now, t.children.seenAt, t.children.seenAtOn)
}
