import type { AlertKind } from '../api/devices'
import { statusLevel } from './childStatus'

// Ordre des cartes de l'accueil parent (NAR-193) : l'enfant qui demande le plus d'attention
// en haut. Rang : 0 silence, 1 carte SIM absente, 2 batterie faible, 3 tout va bien,
// 4 aucun téléphone ; null = état pas encore lu (chargement, échec), jamais deviné.
export type SeverityRank = 0 | 1 | 2 | 3 | 4

export function severityRank(lastSeenAt: string | null, alerts: readonly AlertKind[] | null): SeverityRank | null {
  const level = statusLevel(lastSeenAt, alerts)
  if (level === null) return null
  if (level === 'none') return 4
  if (alerts?.includes('silent')) return 0
  if (alerts?.includes('sim_absent')) return 1
  if (alerts?.includes('battery_low')) return 2
  return 3
}

// Tri stable par gravité. `previous` : identifiants dans l'ordre affiché jusqu'ici (les
// inconnus de cette liste suivent, dans l'ordre reçu). Un enfant au rang inconnu garde sa
// place ; les autres occupent les places restantes, du plus grave au moins grave, à
// égalité dans l'ordre affiché. Relancé sur son propre résultat, l'ordre ne bouge pas :
// une relecture aux mêmes états ne déplace aucune carte.
export function sortBySeverity<T extends { id: string }>(
  items: readonly T[],
  rank: (item: T) => SeverityRank | null,
  previous: readonly string[] = []
): T[] {
  const place = new Map(previous.map((id, i) => [id, i]))
  const base = items
    .map((item, i) => ({ item, i, at: place.get(item.id) ?? previous.length + i }))
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item)
  const ranks = base.map(rank)
  const known = base
    .map((item, i) => ({ item, i, r: ranks[i] }))
    .filter((k): k is { item: T, i: number, r: SeverityRank } => k.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
  let next = 0
  return base.map((item, i) => (ranks[i] === null ? item : known[next++].item))
}
