import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/http'
import { MESSAGES } from '../i18n/messages'
import { authErrorText } from './authErrors'

describe('authErrorText', () => {
  const t = MESSAGES.fr
  it('traduit les refus propres au numéro de téléphone, sans le texte du serveur', () => {
    expect(authErrorText(new ApiError(403, 'Confirmez votre numéro…', 'phone_unverified'), t)).toBe(t.auth.phoneUnverified)
    expect(authErrorText(new ApiError(503, 'Les SMS sont indisponibles…', 'sms_unavailable'), t)).toBe(t.auth.smsUnavailable)
    expect(authErrorText(new ApiError(429, 'Trop de SMS…', 'sms_rate_limited'), MESSAGES.en)).toBe(MESSAGES.en.auth.smsTooMany)
    expect(authErrorText(new ApiError(400, 'Code invalide…', 'invalid_code'), MESSAGES.mg)).toBe(MESSAGES.mg.auth.invalidCode)
    expect(authErrorText(new ApiError(400, 'Numéro de téléphone invalide.', 'invalid_phone'), MESSAGES.en)).toBe(MESSAGES.en.auth.invalidPhone)
    expect(authErrorText(new ApiError(400, 'Cochez la case…', 'consent_required'), t)).toBe(t.consent.required)
  })
  it('un 429 sans code (garde de connexion, limiteur) reste « trop de tentatives »', () => {
    expect(authErrorText(new ApiError(429, 'Too Many Requests'), t)).toBe(t.errors.tooMany)
  })
  it('un 503 sans code reste « service occupé », pas « SMS indisponibles »', () => {
    expect(authErrorText(new ApiError(503, 'x'), t)).toBe(t.errors.busy)
  })
  it('sinon, le texte commun', () => {
    expect(authErrorText(new ApiError(0, 'network'), t)).toBe(t.errors.network)
    expect(authErrorText(new Error('x'), t)).toBe(t.errors.generic)
  })
  it('chaque message existe dans les trois langues et diffère d’une langue à l’autre', () => {
    for (const key of ['phoneUnverified', 'smsUnavailable', 'smsTooMany', 'invalidCode', 'invalidPhone'] as const) {
      const texts = (['mg', 'fr', 'en'] as const).map((l) => MESSAGES[l].auth[key])
      expect(texts.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
      expect(new Set(texts).size).toBe(3)
    }
  })
})
