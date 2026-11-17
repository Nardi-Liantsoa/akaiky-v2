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
