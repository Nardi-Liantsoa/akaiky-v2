import { ApiError } from '../api/http'
import type { Messages } from '../i18n/messages'

// Message traduit pour une erreur d'API. Une erreur réseau n'est pas une
// déconnexion : seul un 401 du serveur dit que la session est perdue.
export function errorText(e: unknown, t: Messages): string {
  if (!(e instanceof ApiError)) return t.errors.generic
  switch (e.status) {
    case 0: return t.errors.network
    case 401: return t.errors.session
    case 403: return t.errors.forbidden
    case 404: return t.errors.notFound
    case 429: return t.errors.tooMany
    case 503: return t.errors.busy
    case 400: return e.message || t.errors.generic
    default: return t.errors.generic
  }
}
