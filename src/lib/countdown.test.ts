import { describe, expect, it } from 'vitest'
import { remaining } from './countdown'

describe('remaining', () => {
  const end = '2026-11-18T10:15:00.000Z'
  const at = (iso: string) => Date.parse(iso)

  it('minutes et secondes restantes, arrondies à la seconde supérieure', () => {
    expect(remaining(end, at('2026-11-18T10:00:00.000Z'))).toBe('15:00')
    expect(remaining(end, at('2026-11-18T10:14:50.500Z'))).toBe('0:10')
    expect(remaining(end, at('2026-11-18T10:14:59.900Z'))).toBe('0:01')
  })

  it('expiré ou date illisible : null', () => {
    expect(remaining(end, at('2026-11-18T10:15:00.000Z'))).toBeNull()
    expect(remaining(end, at('2026-11-18T11:00:00.000Z'))).toBeNull()
    expect(remaining('pas une date', 0)).toBeNull()
  })
})
