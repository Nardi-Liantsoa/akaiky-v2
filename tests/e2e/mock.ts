import type { Page, Request } from '@playwright/test'

export const USER = { id: '6f1c2b1e-0000-4000-8000-000000000001', email: 'alice@exemple.fr', name: 'Alice', is_admin: false }

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
    const res = handlers[key]?.(route.request()) ?? { status: 404, body: { error: 'Introuvable.' } }
    return route.fulfill({ status: res.status ?? 200, contentType: 'application/json', body: JSON.stringify(res.body ?? {}) })
  })
  return calls
}
