import { describe, expect, it } from 'vitest'
import { emergencyNumber } from './emergency'

describe('emergencyNumber', () => {
  it('Madagascar : 117 ; France : 112 ; inconnu ou absent : 112', () => {
    expect(emergencyNumber('MG')).toBe('117')
    expect(emergencyNumber('mg')).toBe('117')
    expect(emergencyNumber('FR')).toBe('112')
    expect(emergencyNumber('XX')).toBe('112')
    expect(emergencyNumber(null)).toBe('112')
  })
})
