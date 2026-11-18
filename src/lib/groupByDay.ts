// Regroupement du journal par jour (NAR-152), à l'heure de Madagascar (fuseau de la
// famille) : « Aujourd'hui », « Hier », puis la date. L'ordre reçu est gardé.
const TZ = 'Indian/Antananarivo'
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

export interface DayGroup<T> { key: string, when: 'today' | 'yesterday' | 'earlier', date: Date, items: T[] }

export function groupByDay<T>(items: T[], at: (item: T) => string, now: Date = new Date()): DayGroup<T>[] {
  const today = dayKey(now)
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000))
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const date = new Date(at(item))
    if (Number.isNaN(date.getTime())) continue
    const key = dayKey(date)
    let group = groups.at(-1)
    if (group?.key !== key) {
      group = { key, when: key === today ? 'today' : key === yesterday ? 'yesterday' : 'earlier', date, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
