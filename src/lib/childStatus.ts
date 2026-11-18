import type { Messages, Locale } from '../i18n/messages'
import { formatClock, formatDay } from './format'
import { dayKey } from './groupByDay'

// État du téléphone d'un enfant, pour sa carte (NAR-174) : « Téléphone vu à 14:05 »
// aujourd'hui, sinon avec la date ; « Aucun téléphone relié » sans téléphone appairé.
// Batterie, réseau et carte SIM viendront avec NAR-147.
export function phoneStatus(lastSeenAt: string | null, t: Messages, locale: Locale, now: Date = new Date()): string {
  if (!lastSeenAt) return t.children.noPhone
  const seen = new Date(lastSeenAt)
  if (Number.isNaN(seen.getTime())) return t.children.noPhone
  const seenKey = dayKey(seen), nowKey = dayKey(now)
  if (seenKey === nowKey) return t.children.seenToday(formatClock(seen))
  // Autre année : l'année est ajoutée (un téléphone éteint depuis longtemps se voit).
  const day = formatDay(lastSeenAt, locale) + (seenKey.slice(0, 4) === nowKey.slice(0, 4) ? '' : ` ${seenKey.slice(0, 4)}`)
  return t.children.seenOn(day, formatClock(seen))
}
