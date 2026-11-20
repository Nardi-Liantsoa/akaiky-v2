import { describe, expect, it } from 'vitest'
import shared from '../../tests/fixtures/emergency-numbers.json'
import { emergencyNumber } from './emergency'

describe('emergencyNumber', () => {
  it('Madagascar : 117 ; France : 112 ; inconnu ou absent : 112', () => {
    expect(emergencyNumber('MG')).toBe('117')
    expect(emergencyNumber('mg')).toBe('117')
    expect(emergencyNumber('FR')).toBe('112')
    expect(emergencyNumber('XX')).toBe('112')
    expect(emergencyNumber(null)).toBe('112')
  })

  it('chaque numéro du bouton est une urgence du natif (NAR-197)', () => {
    for (const country of ['MG', 'FR', 'XX', null]) expect(shared.emergency).toContain(emergencyNumber(country))
    for (const removed of ['15', '17', '18']) expect(shared.notEmergency).toContain(removed)
  })
})
