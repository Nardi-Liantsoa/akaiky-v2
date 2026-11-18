import type { Page, Request } from '@playwright/test'

export const USER = { id: '6f1c2b1e-0000-4000-8000-000000000001', email: 'alice@exemple.fr', name: 'Alice', is_admin: false }
export const FAMILY = { id: '6f1c2b1e-0000-4000-8000-0000000000f1', name: 'Famille Rabe', role: 'owner', members: [{ userId: USER.id, name: USER.name, role: 'owner', isMe: true }] }

type Handler = (req: Request) => { status?: number, body?: unknown } | undefined

// API simulée : chaque test déclare les réponses dont il a besoin. Toute
// requête vers une autre origine que le front est bloquée (réseau strict).
export async function mockApi(page: Page, handlers: Record<string, Handler>) {
  const calls: Request[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort('blockedbyclient')
    if (!url.pathname.startsWith('/api/')) return route.fallback()
    calls.push(route.request())
    const key = `${route.request().method()} ${url.pathname}`
    // Textes des messages rapides (NAR-173), présents sur Réglages : par défaut, non modifiés.
    // Plages horaires (NAR-148), présentes sur Réglages aussi : aucune par défaut.
    const get = route.request().method() === 'GET'
    const fallback = get && url.pathname.endsWith('/message-templates')
      ? { body: [1, 2, 3, 4].map((slot) => ({ slot, text: null })) }
      : get && url.pathname.endsWith('/schedules') ? { body: [] } : { status: 404, body: { error: 'Introuvable.' } }
    const res = handlers[key]?.(route.request()) ?? fallback
    return route.fulfill({ status: res.status ?? 200, contentType: 'application/json', body: JSON.stringify(res.body ?? {}) })
  })
  return calls
}
