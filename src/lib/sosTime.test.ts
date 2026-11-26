import { describe, expect, it } from 'vitest'
import { MESSAGES } from '../i18n/messages'
import { formatCoord, shortDuration } from './sosTime'

const t = MESSAGES.fr
describe('shortDuration', () => {
  it('secondes, minutes, heures ; jamais négative', () => {
    expect(shortDuration(12_400, t)).toBe('12 s')
    expect(shortDuration(59_999, t)).toBe('59 s')
    expect(shortDuration(60_000, t)).toBe('1 min')
    expect(shortDuration(3_599_000, t)).toBe('59 min')
    expect(shortDuration(7_200_000, t)).toBe('2 h')
    expect(shortDuration(-3_000, t)).toBe('0 s')
    expect(shortDuration(7_200_000, MESSAGES.mg)).toBe('2 ora')
  })
})
describe('formatCoord', () => {
  it('5 décimales, virgule en français et en malgache', () => {
    expect(formatCoord(-18.914561, 'fr')).toBe('-18,91456')
    expect(formatCoord(47.531234, 'en')).toBe('47.53123')
  })
})
