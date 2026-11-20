import { ApiError } from '../api/http'
import type { Messages } from '../i18n/messages'
import { errorText } from './errors'

// Refus d'une action de l'équipe (NAR-199) : les codes que le serveur nomme (soi-même,
// dernier administrateur, compte ou téléphone introuvable) ont leur texte ; le reste suit
// errorText (session, droits, réseau…).
export function adminErrorText(e: unknown, t: Messages): string {
  if (e instanceof ApiError && e.code) {
    // Clé propre seulement : un code « constructor » ou « toString » ne lit pas le prototype.
    const known = t.admin.errors as Record<string, string | undefined>
    const text = Object.hasOwn(known, e.code) ? known[e.code] : undefined
    if (typeof text === 'string') return text
  }
  return errorText(e, t)
}
