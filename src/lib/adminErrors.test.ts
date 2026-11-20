import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/http'
import { MESSAGES } from '../i18n/messages'
import { adminErrorText } from './adminErrors'

describe('adminErrorText', () => {
  const t = MESSAGES.fr
  it('nomme les refus propres au back-office', () => {
    expect(adminErrorText(new ApiError(409, 'x', 'self_disable'), t)).toBe(t.admin.errors.self_disable)
    expect(adminErrorText(new ApiError(409, 'x', 'last_admin'), t)).toBe(t.admin.errors.last_admin)
    expect(adminErrorText(new ApiError(404, 'x', 'device_not_found'), t)).toBe(t.admin.errors.device_not_found)
    expect(adminErrorText(new ApiError(404, 'x', 'user_not_found'), MESSAGES.mg)).toBe(MESSAGES.mg.admin.errors.user_not_found)
  })
  it('sinon, le texte commun selon le statut', () => {
    expect(adminErrorText(new ApiError(403, 'x'), t)).toBe(t.errors.forbidden)
    expect(adminErrorText(new ApiError(409, 'x', 'autre_code'), t)).toBe(t.errors.generic)
    expect(adminErrorText(new ApiError(0, 'network'), t)).toBe(t.errors.network)
    expect(adminErrorText(new Error('x'), t)).toBe(t.errors.generic)
  })
  it('un code qui porte le nom d’une clé du prototype reste inconnu', () => {
    expect(adminErrorText(new ApiError(409, 'x', 'constructor'), t)).toBe(t.errors.generic)
    expect(adminErrorText(new ApiError(409, 'x', 'toString'), t)).toBe(t.errors.generic)
  })
})
