import type { Locale, Messages } from '../i18n/messages'

// Seul module de formatage des dates, heures et durées de l'app (NAR-212) : aucun autre
// fichier n'appelle Intl ni toLocale* pour afficher une date (vérifié par format.test.ts).
// Dates à l'heure de Madagascar. Les noms de mois et de jours malgaches sont écrits ici :
// Intl ne les fournit pas partout (WebView anciennes, iOS).
export const TZ = 'Indian/Antananarivo'
const MG_MONTHS = ['Janoary', 'Febroary', 'Martsa', 'Aprily', 'Mey', 'Jona', 'Jolay', 'Aogositra', 'Septambra', 'Oktobra', 'Novambra', 'Desambra']

export function formatDay(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (locale === 'mg') {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric' }).formatToParts(date)
    const day = parts.find((p) => p.type === 'day')?.value
    const month = Number(parts.find((p) => p.type === 'month')?.value)
    return `${Number(day)} ${MG_MONTHS[month - 1]}`
  }
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: TZ, day: 'numeric', month: 'long' }).format(date)
}

const MG_DAYS = ['Alahady', 'Alatsinainy', 'Talata', 'Alarobia', 'Alakamisy', 'Zoma', 'Asabotsy']

// Heure de l'écran de l'enfant (« 14:05 »), à l'heure de Madagascar ou du fuseau donné
// (fin d'une plage « école », dans le fuseau de la famille).
export function formatClock(date: Date, timeZone: string = TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

// Jour et date de l'écran de l'enfant (« mardi 18 novembre », « Talata 18 Novambra »).
export function formatLongDate(date: Date, locale: Locale): string {
  if (Number.isNaN(date.getTime())) return ''
  if (locale === 'mg') {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' }).formatToParts(date)
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '')
    const day = Number(parts.find((p) => p.type === 'day')?.value)
    const month = Number(parts.find((p) => p.type === 'month')?.value)
    return `${MG_DAYS[weekday]} ${day} ${MG_MONTHS[month - 1]}`
  }
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(date)
}

// Date et heure (back-office NAR-144, appareils de « Mon compte »), à l'heure de Madagascar :
// « 15 janv. 2026, 13:00 », « 15 Jan 2026, 13:00 », « 15 Janoary 2026, 13:00 ».
export function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (locale === 'mg') {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(date)
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    return `${part('day')} ${MG_MONTHS[part('month') - 1]} ${part('year')}, ${formatClock(date)}`
  }
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

// Jour (AAAA-MM-JJ) à l'heure de Madagascar, pour regrouper par jour (journal, NAR-152) ;
// formateur créé au premier appel puis gardé (coûteux sur les WebView anciennes), jamais au
// chargement du module : un fuseau refusé ne casse que l'appel, pas l'écran qui importe.
let day: Intl.DateTimeFormat | null = null
export function dayKey(date: Date): string {
  day ??= new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  return day.format(date)
}

// Durée écoulée en clair (« il y a 2 minutes », « 2 minitra lasa izay »), NAR-147.
// Français et anglais : Intl.RelativeTimeFormat quand la WebView l'a (Chrome 71+) ;
// malgache, ou Intl absent : textes de messages.ts (`relative`). Moins d'une minute :
// « à l'instant » ; une date dans le futur (horloge du téléphone en avance) aussi.
type Unit = 'minutes' | 'hours' | 'days'
const INTL_UNIT = { minutes: 'minute', hours: 'hour', days: 'day' } as const

export function relativeTime(iso: string | null, t: Messages, locale: Locale, now: Date = new Date(), intl = globalThis.Intl): string {
  const at = iso ? Date.parse(iso) : Number.NaN
  if (Number.isNaN(at)) return ''
  const minutes = Math.floor((now.getTime() - at) / 60_000)
  if (minutes < 1) return t.relative.justNow
  const [unit, n]: [Unit, number] = minutes < 60 ? ['minutes', minutes]
    : minutes < 24 * 60 ? ['hours', Math.floor(minutes / 60)] : ['days', Math.floor(minutes / (24 * 60))]
  if (locale !== 'mg' && typeof intl?.RelativeTimeFormat === 'function') {
    try {
      return new intl.RelativeTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { numeric: 'always' }).format(-n, INTL_UNIT[unit])
    } catch { /* langue refusée : textes ci-dessous */ }
  }
  return t.relative[unit](n)
}
