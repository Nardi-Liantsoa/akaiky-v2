import type { Messages } from '../i18n/messages'

// Durée courte d'une alerte SOS (NAR-249) : « 12 s », « 3 min », « 2 h ». Négative (horloge du
// téléphone en avance sur le serveur) : 0 s, jamais « il y a -3 s ».
export function shortDuration(ms: number, t: Messages): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return t.sosAlert.secs(s)
  if (s < 3600) return t.sosAlert.mins(Math.floor(s / 60))
  return t.sosAlert.hours(Math.floor(s / 3600))
}

// Coordonnée affichée à 5 décimales (~1 m), virgule décimale en français et en malgache.
export function formatCoord(n: number, locale: string): string {
  const fixed = n.toFixed(5)
  return locale === 'en' ? fixed : fixed.replace('.', ',')
}
