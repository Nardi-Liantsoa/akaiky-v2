import { describe, expect, it } from 'vitest'
import { clampDay, dayBounds, dayDate, shiftDay } from './journalDay'
import { dayKey } from './format'

describe('jour du journal', () => {
  it('avance et recule d’un jour, fins de mois et d’année comprises', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('bornes : aujourd’hui à Madagascar et 89 jours avant', () => {
    // 22:30 UTC le 24 = 01:30 le 25 à Antananarivo.
    const now = new Date('2026-11-24T22:30:00Z')
    expect(dayBounds(now)).toEqual({ max: '2026-11-25', min: '2026-08-28' })
  })
  it('refuse un jour mal formé, inexistant ou hors bornes', () => {
    const now = new Date('2026-11-25T09:00:00Z')
    expect(clampDay('2026-11-25', now)).toBe('2026-11-25')
    expect(clampDay('2026-08-28', now)).toBe('2026-08-28')
    expect(clampDay('2026-08-27', now)).toBeNull()
    expect(clampDay('2026-11-26', now)).toBeNull()
    expect(clampDay('2026-02-30', now)).toBeNull()
    expect(clampDay('', now)).toBeNull()
  })
  it('la date affichée tombe sur le bon jour à Madagascar', () => {
    expect(dayKey(dayDate('2026-11-25'))).toBe('2026-11-25')
  })
})
