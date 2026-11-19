import type { Locale, Messages } from '../i18n/messages'

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
