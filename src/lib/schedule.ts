import { TZ } from './format'

// Plages horaires « école » (NAR-148) : calcul pur, fait sur le téléphone, hors ligne.
// Une plage : jours (bit 0 = lundi … bit 6 = dimanche), début et fin en minutes depuis
// minuit dans le fuseau de la famille ; fin ≤ début = la plage traverse minuit (elle
// commence le jour coché et finit le lendemain).
export interface ScheduleRule { label: string, days: number, startMin: number, endMin: number }
export interface ActiveWindow { label: string, until: Date | null }

const DAY = 1440
const WEEK = 7 * DAY

// Fuseau utilisable (nom IANA connu de ce WebView) ; sinon celui de Madagascar.
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return TZ
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return TZ }
}

// Minute de la semaine (lundi 0:00 = 0) dans le fuseau donné.
export function weekMinute(now: Date, timeZone: string): number {
  // hour12: false et non hourCycle (ignoré avant Chrome 73, WebView minimal 64) ; certains
  // moteurs écrivent minuit « 24 » : ramené à 0.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'))
  return day * DAY + (Number(get('hour')) % 24) * 60 + Number(get('minute'))
}

// Intervalles [début, fin) en minutes de la semaine ; une fin peut dépasser la semaine
// (dimanche soir → lundi matin), le test d'appartenance en tient compte.
function intervals(rule: ScheduleRule): [number, number][] {
  const out: [number, number][] = []
  const length = rule.endMin > rule.startMin ? rule.endMin - rule.startMin : DAY - rule.startMin + rule.endMin
  for (let d = 0; d < 7; d++) {
    if (rule.days & (1 << d)) out.push([d * DAY + rule.startMin, d * DAY + rule.startMin + length])
  }
  return out
}
const inside = (m: number, [a, b]: [number, number]) => (m >= a && m < b) || (m + WEEK >= a && m + WEEK < b)
// Fin de l'intervalle compté depuis m (en minutes à venir).
const remaining = (m: number, [a, b]: [number, number]) => (m >= a && m < b ? b - m : b - (m + WEEK))

// Plage active à cet instant, et l'heure où plus aucune plage ne l'est (plages qui se
// suivent ou se chevauchent mises bout à bout). until = null : plage sans fin (toute la
// semaine couverte). Le nom retenu est celui de la plage en cours qui finit le plus tard.
export function activeWindow(now: Date, rules: readonly ScheduleRule[], timeZone: string): ActiveWindow | null {
  const all = rules.flatMap((r) => intervals(r).map((iv) => ({ iv, label: r.label })))
  const start = weekMinute(now, timeZone)
  const current = all.filter(({ iv }) => inside(start, iv))
  if (!current.length) return null
  const label = current.reduce((best, x) => (remaining(start, x.iv) > remaining(start, best.iv) ? x : best)).label
  let ahead = 0
  // Avance jusqu'à une minute qu'aucune plage ne couvre ; au plus une semaine.
  while (ahead < WEEK) {
    const m = (start + ahead) % WEEK
    const covering = all.filter(({ iv }) => inside(m, iv))
    if (!covering.length) break
    ahead += Math.max(...covering.map(({ iv }) => remaining(m, iv)))
  }
  if (ahead >= WEEK) return { label, until: null }
  // Début de la minute courante + minutes restantes (pas de changement d'heure à Madagascar ;
  // ailleurs, l'heure de fin peut décaler d'une heure le jour du changement).
  const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000
  return { label, until: new Date(minuteStart + ahead * 60_000) }
}

// Libellés courts : « 8:00 », jours « lun–ven ».
export const clock = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`

// Jours d'une plage en clair : « Lun–Ven » pour une suite d'au moins 3 jours, sinon la
// liste ; tous les jours : every.
export function daysSummary(mask: number, names: readonly string[], every: string): string {
  if ((mask & 127) === 127) return every
  const on = [0, 1, 2, 3, 4, 5, 6].filter((d) => mask & (1 << d))
  const runs: number[][] = []
  for (const d of on) {
    const last = runs.at(-1)
    if (last && last.at(-1) === d - 1) last.push(d)
    else runs.push([d])
  }
  return runs.map((r) => (r.length >= 3 ? `${names[r[0]]}–${names[r.at(-1)!]}` : r.map((d) => names[d]).join(', '))).join(', ')
}
// Minutes ⇄ « HH:MM » des champs <input type="time">.
export const toTimeInput = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export function fromTimeInput(v: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v)
  if (!m) return null
  const h = Number(m[1]), mm = Number(m[2])
  return h < 24 && mm < 60 ? h * 60 + mm : null
}

// Contacts montrés à l'enfant : pendant une plage, les seuls parents (owner, manager).
export const visibleContacts = <T extends { parent?: boolean }>(contacts: readonly T[], window: ActiveWindow | null): T[] =>
  window ? contacts.filter((c) => c.parent === true) : [...contacts]
