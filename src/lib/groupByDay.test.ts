import { describe, expect, it } from 'vitest'
import { groupByDay } from './groupByDay'

// Madagascar = UTC+3 : 22:30 UTC le 17 est déjà le 18 à Antananarivo.
const now = new Date('2026-11-18T09:00:00Z')
const item = (id: string, at: string) => ({ id, at })

describe('groupByDay', () => {
  it('aujourd’hui, hier, puis les jours précédents, à l’heure de Madagascar', () => {
    const groups = groupByDay([
      item('a', '2026-11-18T08:00:00Z'),
      item('b', '2026-11-17T22:30:00Z'), // 18 novembre 01:30 à Antananarivo
      item('c', '2026-11-17T20:00:00Z'), // 17 novembre 23:00
      item('d', '2026-11-15T10:00:00Z')
    ], (i) => i.at, now)
    expect(groups.map((g) => [g.key, g.when, g.items.map((i) => i.id)])).toEqual([
      ['2026-11-18', 'today', ['a', 'b']],
      ['2026-11-17', 'yesterday', ['c']],
      ['2026-11-15', 'earlier', ['d']]
    ])
  })

  it('date illisible écartée ; liste vide → aucun groupe', () => {
    expect(groupByDay([item('x', 'pas une date')], (i) => i.at, now)).toEqual([])
    expect(groupByDay([], (i: { at: string }) => i.at, now)).toEqual([])
  })
})
