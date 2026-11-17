import { describe, expect, it } from 'vitest'
import { familyNameValid } from './familyName'

describe('nom de famille', () => {
  it('1 à 80 caractères après retrait des espaces', () => {
    expect(familyNameValid('Rabe')).toBe(true)
    expect(familyNameValid('   ')).toBe(false)
    expect(familyNameValid('x'.repeat(80))).toBe(true)
    expect(familyNameValid('x'.repeat(81))).toBe(false)
  })
  it('compte les emoji comme un caractère, comme le serveur', () => {
    expect(familyNameValid('🏠'.repeat(80))).toBe(true)
    expect(familyNameValid('🏠'.repeat(81))).toBe(false)
  })
})
