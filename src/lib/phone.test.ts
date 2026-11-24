import { describe, expect, it } from 'vitest'
import { formatPhone, samePhone } from './phone'

describe('formatPhone', () => {
  it('groupes lisibles pour Madagascar et la France, autres numéros tels quels', () => {
    expect(formatPhone('+261341234567')).toBe('+261 34 12 345 67')
    expect(formatPhone('+33612345678')).toBe('+33 6 12 34 56 78')
    expect(formatPhone('+14155550123')).toBe('+14155550123')
  })
})

describe('samePhone', () => {
  it('la forme lisible d’un numéro est ce numéro', () => {
    expect(samePhone('+261 34 12 345 67', '+261341234567')).toBe(true)
    expect(samePhone(' +261341234567 ', '+261341234567')).toBe(true)
    expect(samePhone('+261-34-12.345 (67)', '+261341234567')).toBe(true)
  })
  it('un autre numéro, ou une écriture locale, est un changement', () => {
    expect(samePhone('+261 34 12 345 68', '+261341234567')).toBe(false)
    expect(samePhone('034 12 345 67', '+261341234567')).toBe(false)
  })
  it('vide et absent se valent', () => {
    expect(samePhone('', null)).toBe(true)
    expect(samePhone('  ', null)).toBe(true)
    expect(samePhone('', '+261341234567')).toBe(false)
    expect(samePhone('+261341234567', null)).toBe(false)
  })
})
