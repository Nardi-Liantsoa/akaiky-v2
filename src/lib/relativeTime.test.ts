import { describe, expect, it } from 'vitest'
import { MESSAGES } from '../i18n/messages'
import { relativeTime } from './relativeTime'

const now = new Date('2026-11-19T12:00:00Z')
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

describe('relativeTime', () => {
  it('français et anglais par Intl', () => {
    expect(relativeTime(ago(2), MESSAGES.fr, 'fr', now)).toBe('il y a 2 minutes')
    expect(relativeTime(ago(1), MESSAGES.fr, 'fr', now)).toBe('il y a 1 minute')
    expect(relativeTime(ago(125), MESSAGES.fr, 'fr', now)).toBe('il y a 2 heures')
    expect(relativeTime(ago(3 * 24 * 60), MESSAGES.en, 'en', now)).toBe('3 days ago')
    expect(relativeTime(ago(59), MESSAGES.en, 'en', now)).toBe('59 minutes ago')
  })
  it('malgache : textes du catalogue', () => {
    expect(relativeTime(ago(2), MESSAGES.mg, 'mg', now)).toBe('2 minitra lasa izay')
    expect(relativeTime(ago(60), MESSAGES.mg, 'mg', now)).toBe('1 ora lasa izay')
    expect(relativeTime(ago(2 * 24 * 60 + 5), MESSAGES.mg, 'mg', now)).toBe('2 andro lasa izay')
  })
  it('sans Intl.RelativeTimeFormat : mêmes textes, du catalogue', () => {
    const bare = {} as typeof Intl
    expect(relativeTime(ago(2), MESSAGES.fr, 'fr', now, bare)).toBe('il y a 2 minutes')
    expect(relativeTime(ago(1), MESSAGES.en, 'en', now, bare)).toBe('1 minute ago')
    expect(relativeTime(ago(24 * 60), MESSAGES.fr, 'fr', now, bare)).toBe('il y a 1 jour')
  })
  it('moins d’une minute, futur, date invalide', () => {
    expect(relativeTime(ago(0.5), MESSAGES.fr, 'fr', now)).toBe('à l’instant')
    expect(relativeTime(ago(-10), MESSAGES.mg, 'mg', now)).toBe('vao izao')
    expect(relativeTime('pas une date', MESSAGES.fr, 'fr', now)).toBe('')
    expect(relativeTime(null, MESSAGES.fr, 'fr', now)).toBe('')
  })
})
