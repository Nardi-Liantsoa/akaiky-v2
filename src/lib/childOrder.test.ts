import { describe, expect, it } from 'vitest'
import type { AlertKind } from '../api/devices'
import { severityRank, sortBySeverity, type SeverityRank } from './childOrder'

const seen = '2026-11-18T11:05:00Z'

describe('severityRank', () => {
  it('silence, carte SIM, batterie, tout va bien, aucun téléphone', () => {
    expect(severityRank(seen, ['silent'])).toBe(0)
    expect(severityRank(seen, ['sim_absent'])).toBe(1)
    expect(severityRank(seen, ['battery_low'])).toBe(2)
    expect(severityRank(seen, [])).toBe(3)
    expect(severityRank(null, null)).toBe(4)
    expect(severityRank(null, ['silent'])).toBe(4)
  })
  it('plusieurs alertes : la plus grave compte', () => {
    expect(severityRank(seen, ['battery_low', 'silent'])).toBe(0)
    expect(severityRank(seen, ['battery_low', 'sim_absent'])).toBe(1)
    expect(severityRank(seen, ['battery_low', 'sim_absent', 'silent'])).toBe(0)
  })
  it('état pas encore lu : inconnu', () => {
    expect(severityRank(seen, null)).toBeNull()
  })
})

type Kid = { id: string, seen: string | null, alerts: AlertKind[] | null }
const kid = (id: string, alerts: AlertKind[] | null, phone = true): Kid => ({ id, seen: phone ? seen : null, alerts })
const rank = (k: Kid): SeverityRank | null => severityRank(k.seen, k.alerts)
const ids = (list: Kid[]) => list.map((k) => k.id)

describe('sortBySeverity', () => {
  it('du plus grave au moins grave, sans téléphone en dernier', () => {
    const list = [kid('ok', []), kid('none', null, false), kid('batt', ['battery_low']), kid('sim', ['sim_absent']), kid('silent', ['silent'])]
    expect(ids(sortBySeverity(list, rank))).toEqual(['silent', 'sim', 'batt', 'ok', 'none'])
  })
  it('égalité : ordre reçu, puis ordre affiché', () => {
    const list = [kid('a', []), kid('b', ['battery_low']), kid('c', []), kid('d', ['battery_low'])]
    expect(ids(sortBySeverity(list, rank))).toEqual(['b', 'd', 'a', 'c'])
    expect(ids(sortBySeverity(list, rank, ['d', 'c', 'b', 'a']))).toEqual(['d', 'b', 'c', 'a'])
  })
  it('plusieurs alertes : rangé selon la plus grave', () => {
    const list = [kid('batt', ['battery_low']), kid('both', ['battery_low', 'sim_absent']), kid('all', ['battery_low', 'silent'])]
    expect(ids(sortBySeverity(list, rank))).toEqual(['all', 'both', 'batt'])
  })
  it('état inconnu : garde sa place, les autres se rangent autour', () => {
    const list = [kid('ok', []), kid('unknown', null), kid('silent', ['silent'])]
    expect(ids(sortBySeverity(list, rank))).toEqual(['silent', 'unknown', 'ok'])
    // Place relue dans l'ordre affiché, pas dans l'ordre reçu.
    expect(ids(sortBySeverity(list, rank, ['unknown', 'ok', 'silent']))).toEqual(['unknown', 'silent', 'ok'])
  })
  it('enfant sans relevé ni téléphone : en dernier, sans attendre un état', () => {
    const list = [kid('none', null, false), kid('ok', [])]
    expect(ids(sortBySeverity(list, rank))).toEqual(['ok', 'none'])
  })
  it('tous inconnus : rien ne bouge', () => {
    const list = [kid('a', null), kid('b', null), kid('c', null)]
    expect(ids(sortBySeverity(list, rank, ['c', 'a', 'b']))).toEqual(['c', 'a', 'b'])
  })
  it('relancé sur son résultat aux mêmes états : même ordre (relecture)', () => {
    const list = [kid('a', []), kid('b', null), kid('c', ['battery_low']), kid('d', []), kid('e', ['silent'])]
    const first = ids(sortBySeverity(list, rank))
    expect(ids(sortBySeverity(list, rank, first))).toEqual(first)
    // Relecture en échec (état redevenu inconnu) : l'enfant reste où il était.
    const failed = list.map((k) => (k.id === 'c' ? { ...k, alerts: null } : k))
    expect(ids(sortBySeverity(failed, rank, first))).toEqual(first)
  })
  it('enfants absents de l’ordre affiché : à la suite, dans l’ordre reçu ; retirés : ignorés', () => {
    const list = [kid('new1', []), kid('a', []), kid('new2', [])]
    expect(ids(sortBySeverity(list, rank, ['gone', 'a']))).toEqual(['a', 'new1', 'new2'])
  })
  it('ne modifie pas la liste reçue', () => {
    const list = [kid('ok', []), kid('silent', ['silent'])]
    sortBySeverity(list, rank)
    expect(ids(list)).toEqual(['ok', 'silent'])
  })
})
