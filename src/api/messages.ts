import { api } from './http'

// Messages rapides de l'enfant (NAR-150) : affichés dans le journal (NAR-152), marqués
// comme vus par le parent qui les voit.
export const markRead = (id: string) => api.post<{ ok: true }>(`/messages/${encodeURIComponent(id)}/read`)

// Messages affichés à ce parent : marqués comme vus (en parallèle) ; renvoie vrai si au
// moins un l'a été (l'appelant relit alors la liste pour « Vu par »).
export async function markShownAsRead(items: { id: string, kind?: string, readByMe?: boolean }[]): Promise<boolean> {
  const unseen = items.filter((m) => (m.kind === undefined || m.kind === 'message') && m.readByMe === false)
  const results = await Promise.all(unseen.map((m) => markRead(m.id).then(() => true, () => false)))
  return results.some(Boolean)
}
