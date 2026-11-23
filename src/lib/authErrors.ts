import { ApiError } from '../api/http'
import type { Messages } from '../i18n/messages'
import { errorText } from './errors'

// Refus de l'inscription, de la connexion et de la réinitialisation, traduits d'après
// les codes stables du serveur (NAR-136, NAR-201). Le texte du serveur est en français
// seulement : il n'est jamais montré pour un code connu.
export function authErrorText(e: unknown, t: Messages): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'phone_unverified': return t.auth.phoneUnverified
      case 'sms_unavailable': return t.auth.smsUnavailable
      case 'sms_rate_limited': return t.auth.smsTooMany
      case 'invalid_code': return t.auth.invalidCode
      case 'invalid_phone': return t.auth.invalidPhone
      case 'consent_required': return t.consent.required
    }
  }
  return errorText(e, t)
}
