import { describe, expect, it } from 'vitest'
import { passwordContainsPhone } from './phonePassword'

describe('passwordContainsPhone', () => {
  it('repère le numéro national, quelle que soit sa présentation', () => {
    expect(passwordContainsPhone('tenimiafina 0341234567', '034 12 345 67')).toBe(true)
    expect(passwordContainsPhone('ma phrase 34.12.345.67 longue', '+261 34 12 345 67')).toBe(true)
    expect(passwordContainsPhone('ma phrase +261-34-12-345-67', '0341234567')).toBe(true)
  })
  it('laisse passer un mot de passe sans le numéro', () => {
    expect(passwordContainsPhone('une phrase de passe longue', '034 12 345 67')).toBe(false)
    expect(passwordContainsPhone('code 34123456 presque', '034 12 345 67')).toBe(false)
  })
  it('un numéro trop court ne bloque rien (le serveur le refusera)', () => {
    expect(passwordContainsPhone('12345678 et plus', '1234')).toBe(false)
  })
})
