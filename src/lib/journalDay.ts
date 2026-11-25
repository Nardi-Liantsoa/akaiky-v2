import { dayKey } from './format'

// Jour du journal (NAR-233) : clé « AAAA-MM-JJ » à l'heure de Madagascar (celle du serveur et
// des nombres du jour). Calculs sur la clé, à midi UTC : jamais de décalage d'heure d'été ni de
// minuit qui fait sauter un jour.
export const JOURNAL_DAYS = 90 // durée de conservation du journal (NAR-153)

const noon = (key: string) => new Date(`${key}T12:00:00Z`)
// Date à afficher pour une clé (midi à Madagascar : le bon jour quel que soit le fuseau).
export const dayDate = (key: string) => new Date(`${key}T09:00:00Z`)

export function shiftDay(key: string, days: number): string {
  const d = noon(key)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Bornes du sélecteur : aujourd'hui au plus tard, 89 jours avant au plus tôt (90 jours en tout).
export function dayBounds(now: Date | string = new Date()): { min: string, max: string } {
  const max = typeof now === 'string' ? now : dayKey(now)
  return { min: shiftDay(max, -(JOURNAL_DAYS - 1)), max }
}

// Nom d'un jour, le même pour le sélecteur et la liste : « Aujourd'hui », « Hier », sinon la date.
export function dayName(key: string, todayKey: string, names: { today: string, yesterday: string }, long: (d: Date) => string): string {
  if (key === todayKey) return names.today
  if (key === shiftDay(todayKey, -1)) return names.yesterday
  return long(dayDate(key))
}

// Clé lue d'un champ date : valide et dans les bornes, sinon null (entrée non fiable).
export function clampDay(raw: string, now: Date | string = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || noon(raw).toISOString().slice(0, 10) !== raw) return null
  const { min, max } = dayBounds(now)
  return raw < min || raw > max ? null : raw
}


