import { describe, expect, it } from 'vitest'
import { formatDay } from './format'

describe('formatDay', () => {
  it('jour et mois à l’heure de Madagascar, dans les trois langues', () => {
    // 22 h UTC le 31 janvier = 1er février 1 h à Antananarivo (UTC+3).
    const iso = '2026-01-31T22:00:00Z'
    expect(formatDay(iso, 'mg')).toBe('1 Febroary')
    expect(formatDay(iso, 'fr')).toBe('1 février')
    expect(formatDay(iso, 'en')).toBe('1 February')
  })
  it('date illisible : chaîne vide', () => {
    expect(formatDay('pas une date', 'fr')).toBe('')
  })
})
