import { describe, expect, it } from 'vitest'
import { formatClock, formatDateTime, formatDay, formatLongDate } from './format'

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

describe('formatClock et formatLongDate (écran de l’enfant)', () => {
  // 18/11/2026 11:05 UTC = 14:05 à Antananarivo (UTC+3), un mercredi.
  const d = new Date('2026-11-18T11:05:00Z')
  it('heure de Madagascar sur 24 h', () => {
    expect(formatClock(d)).toBe('14:05')
    expect(formatClock(new Date('2026-11-18T21:30:00Z'))).toBe('00:30')
  })
  it('jour et date dans les trois langues, noms malgaches écrits', () => {
    expect(formatLongDate(d, 'fr')).toBe('mercredi 18 novembre')
    expect(formatLongDate(d, 'en')).toBe('Wednesday 18 November')
    expect(formatLongDate(d, 'mg')).toBe('Alarobia 18 Novambra')
    expect(formatLongDate(new Date('x'), 'fr')).toBe('')
  })
})

describe('formatDateTime (back-office)', () => {
  it('date et heure de Madagascar, dans les trois langues', () => {
    // 22:30 UTC le 31 décembre 2025 = 1er janvier 2026 01:30 à Antananarivo.
    const iso = '2025-12-31T22:30:00Z'
    expect(formatDateTime(iso, 'mg')).toBe('1 Janoary 2026, 01:30')
    expect(formatDateTime(iso, 'fr')).toMatch(/^1 janv\. 2026.* 01:30$/)
    expect(formatDateTime(iso, 'en')).toMatch(/^1 Jan 2026.* 01:30$/)
  })
  it('date illisible : chaîne vide', () => {
    expect(formatDateTime('nope', 'en')).toBe('')
  })
})

// NAR-212 : toute date affichée passe par ce module. Deux exceptions, qui ne formatent rien :
// schedule.ts (calcul du jour et de l'heure dans un fuseau, règle partagée avec le natif) et
// avatar.ts (découpage en graphèmes et majuscule de l'initiale).
describe('formatage des dates au même endroit', () => {
  it('aucun Intl ni toLocale* hors de format.ts', () => {
    const files = import.meta.glob('../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    // Chemins rendus par Vite : « ./x.ts » pour ce dossier, « ../y/z.ts » ailleurs.
    const allowed = ['./format.ts', './schedule.ts', './avatar.ts']
    const offenders = Object.entries(files)
      .filter(([path]) => !path.endsWith('.test.ts') && !allowed.includes(path) && !path.startsWith('../i18n/'))
      .filter(([, code]) => /\bIntl\.|\.toLocale(String|DateString|TimeString)\(/.test(code))
      .map(([path]) => path)
    expect(offenders).toEqual([])
    expect(Object.keys(files).length).toBeGreaterThan(50)
  })
})
