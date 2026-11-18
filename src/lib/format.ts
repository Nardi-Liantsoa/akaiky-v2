import type { Locale } from '../i18n/messages'

// Dates à l'heure de Madagascar. Les noms de mois malgaches sont écrits ici :
// Intl ne les fournit pas partout (WebView anciennes, iOS).
const TZ = 'Indian/Antananarivo'
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

// Heure de l'écran de l'enfant (« 14:05 »), à l'heure de Madagascar.
export function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
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
