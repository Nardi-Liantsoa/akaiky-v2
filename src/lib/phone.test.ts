import { describe, expect, it } from 'vitest'
import { formatPhone } from './phone'

describe('formatPhone', () => {
  it('groupes lisibles pour Madagascar et la France, autres numéros tels quels', () => {
    expect(formatPhone('+261341234567')).toBe('+261 34 12 345 67')
    expect(formatPhone('+33612345678')).toBe('+33 6 12 34 56 78')
    expect(formatPhone('+14155550123')).toBe('+14155550123')
  })
})
