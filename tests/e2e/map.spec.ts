import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Request } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Carte auto-hébergée (NAR-205) : « Où est Fy ? » et l'alerte SOS, fond servi par notre API
// (extrait d'Antananarivo des tests), aucune requête vers un tiers.
const TILES = readFileSync(new URL('../fixtures/map/tana.pmtiles', import.meta.url))
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString(), sosSiren: false, phone: '+261341234567' }
const MEMBER = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
const POS = { lat: -18.914561, lng: 47.525234, accuracyM: 15 }

async function serveMap(page: Page, { tiles = true } = {}) {
  const ranges: string[] = []
  await page.route('**/api/map/tiles.pmtiles', (route) => {
    if (!tiles) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Carte indisponible."}' })
    const m = /bytes=(\d+)-(\d+)/.exec(route.request().headers().range ?? '')
    ranges.push(route.request().headers().range ?? '')
    if (!m) return route.fulfill({ status: 200, body: TILES })
    const start = Number(m[1]), end = Math.min(Number(m[2]), TILES.length - 1)
    return route.fulfill({ status: 206, headers: { 'content-range': `bytes ${start}-${end}/${TILES.length}`, 'accept-ranges': 'bytes' }, body: TILES.subarray(start, end + 1) })
  })
  await page.route('**/api/map/fonts/*/*', (route) => {
    const [, stack, file] = /\/fonts\/([^/]+)\/([^/]+)$/.exec(new URL(route.request().url()).pathname)!
    try { return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: readFileSync(new URL(`../../server/map/fonts/${stack}/${file}`, import.meta.url)) }) } catch { return route.fulfill({ status: 404, body: '' }) }
  })
  return ranges
}

// Routes de la carte posées APRÈS l'API simulée : la dernière route enregistrée passe d'abord.
async function locate(page: Page, position: object | null, map: { tiles?: boolean } = {}) {
  let asked = 0
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: MEMBER }),
    'GET /api/children': () => ({ body: [FY] }),
    [`POST /api/children/${FY.id}/locate`]: () => { asked++; return { body: { requestedAt: new Date(Date.now() - 2000).toISOString(), watchingUntil: new Date(Date.now() + 120_000).toISOString() } } },
    [`GET /api/children/${FY.id}/position`]: () => ({ body: { position, requestedAt: new Date(Date.now() - 2000).toISOString(), watchingUntil: new Date(Date.now() + 120_000).toISOString() } })
  })
  const ranges = await serveMap(page, map)
  return { calls, ranges, asked: () => asked }
}
const outside: string[] = []
test.beforeEach(({ page }) => { outside.length = 0; page.on('request', (r: Request) => { if (!r.url().startsWith('http://127.0.0.1:4173')) outside.push(r.url()) }) })

test('« Où est Fy ? » : un contact la demande depuis le menu, la carte la montre avec sa précision et son heure ; aucun tiers', async ({ page }) => {
  const t = await locate(page, { ...POS, recordedAt: new Date(Date.now() - 1000).toISOString() })
  await page.goto('/espace')
  await page.getByRole('button', { name: /Actions pour Fy/ }).click()
  // Un contact ne voit que « Où est Fy ? » (pas Modifier ni le code parent).
  await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Où est Fy ?' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Où est Fy ?' })).toBeVisible()
  await expect(page.getByText('Fy verra que vous consultez sa position.')).toBeVisible()
  await expect(page.getByRole('status')).toContainText(/Relevée il y a \d+ s · ±15 m/)
  await expect(page.getByRole('img', { name: 'Carte : position de Fy' }).locator('canvas')).toBeVisible()
  await expect(page.getByText('© OpenStreetMap')).toBeVisible()
  await expect(page.locator('.map-pin')).toHaveText('F')
  expect(t.asked()).toBe(1)
  await expect.poll(() => t.ranges.length).toBeGreaterThan(1)
  // Aucune requête hors de notre origine, et aucune adresse ne contient la position.
  expect(outside).toEqual([])
  const urls = t.calls.map((r) => r.url()).join('\n')
  expect(urls).not.toContain('18.91')
  expect(urls).not.toContain('47.52')
})

test('pas encore de réponse : le dit ; carte indisponible : position en texte', async ({ page }) => {
  await locate(page, { ...POS, recordedAt: new Date(Date.now() - 600_000).toISOString() }, { tiles: false })
  await page.goto(`/espace/enfant/${FY.id}/position`)
  await expect(page.getByRole('status')).toContainText('Dernière position connue, il y a 10 min.')
  await expect(page.getByRole('status')).toContainText('Carte indisponible sur ce téléphone : la position est donnée en texte.')
  await expect(page.getByRole('status')).toContainText('Position -18,91456, 47,52523')
})

test('alerte SOS : la carte remplace la zone vide', async ({ page }) => {
  const ID = '6f1c2b1e-0000-4000-8000-0000000005a1'
  const alert = { id: ID, childId: FY.id, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 9e5).toISOString(), cancelledAt: null, handledAt: null, status: 'active', handledBy: null, position: { ...POS, recordedAt: new Date().toISOString() }, events: [] }
  await mockApi(page, {
    ...me, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/sos/${ID}`]: () => ({ body: alert }), [`POST /api/sos/${ID}/seen`]: () => ({ body: alert })
  })
  await serveMap(page)
  await page.goto(`/espace/sos/${ID}`)
  await expect(page.getByRole('img', { name: 'Carte : position de Fy' }).locator('canvas')).toBeVisible()
  await expect(page.getByText('© OpenStreetMap')).toBeVisible()
  expect(outside).toEqual([])
})

test('demande refusée (trop de demandes) : l’erreur, pas « demande envoyée », et « Redemander »', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: MEMBER }),
    'GET /api/children': () => ({ body: [FY] }),
    [`POST /api/children/${FY.id}/locate`]: () => ({ status: 429, body: { error: 'Trop de demandes.', code: 'locate_rate_limited' } }),
    [`GET /api/children/${FY.id}/position`]: () => ({ body: { position: null, requestedAt: null, watchingUntil: null } })
  })
  await serveMap(page)
  await page.goto(`/espace/enfant/${FY.id}/position`)
  await expect(page.getByRole('alert')).toHaveText('Trop de demandes. Réessayez dans quelques minutes.')
  await expect(page.getByText(/Demande envoyée/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Redemander' })).toBeVisible()
})
