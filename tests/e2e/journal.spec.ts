import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null }
// Heure figée à midi à Antananarivo : groupes par jour indépendants de l'heure d'exécution.
const NOW = new Date('2026-11-18T09:00:00Z')
const now = NOW.getTime()
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString()
const ITEMS = [
  { id: '6f1c2b1e-0000-4000-8000-000000000401', kind: 'call_blocked', at: ago(0.1), contactId: null, name: null, phone: '+261329876543', durationS: null },
  { id: '6f1c2b1e-0000-4000-8000-000000000402', kind: 'call_blocked', at: ago(0.2), contactId: null, name: null, phone: null, durationS: null },
  { id: '6f1c2b1e-0000-4000-8000-000000000403', kind: 'call_in', at: ago(30), contactId: 'c1', name: 'Maman', phone: '+261341234567', durationS: 134 }
]

function journalApi(role = 'owner') {
  const queries: string[] = []
  return {
    queries,
    handlers: {
      ...me,
      'GET /api/families/me': () => ({ body: { ...FAMILY, role } }),
      'GET /api/children': () => ({ body: [FY] }),
      [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
      [`GET /api/children/${FY.id}/journal`]: (req: { url(): string }) => {
        const kind = new URL(req.url()).searchParams.get('kind')
        queries.push(kind ?? '')
        const items = kind === 'blocked' ? ITEMS.filter((i) => i.kind === 'call_blocked') : kind === 'calls' ? ITEMS.filter((i) => i.kind === 'call_in') : ITEMS
        const counts = new URL(req.url()).searchParams.get('counts') === '1'
        return { body: { items, next: null, ...(counts ? { today: { calls: 0, blocked: 2, messages: 0, unlocks: 0 } } : {}) } }
      }
    }
  }
}

test('journal : groupé par jour, compteur « Bloqués », filtres, « Autoriser » pré-remplit le contact', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const api = journalApi()
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  await expect(page.getByRole('heading', { name: 'Aujourd’hui', exact: true })).toBeVisible()
  // Titre des tuiles, « Aujourd'hui », « Hier » (heure figée).
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Aujourd’hui en bref', 'Aujourd’hui', 'Hier'])
  await expect(page.getByText('numéro masqué · n’a pas sonné')).toBeVisible()
  await expect(page.getByText('Appel de Maman')).toBeVisible()
  await expect(page.getByText('2 min 14 s')).toBeVisible()

  // Tuiles du jour (NAR-175) : toucher « Bloqués » filtre, le retoucher revient à « Tout ».
  const blockedTile = page.getByRole('button', { name: /^2 Bloqués$/ })
  await expect(blockedTile).toBeVisible()
  await blockedTile.click()
  await expect(blockedTile).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Appel de Maman')).toHaveCount(0)
  expect(api.queries).toContain('blocked')
  // Nombres gardés après le filtre (pas redemandés), filtre actif annoncé.
  await expect(blockedTile).toHaveText(/^2/)
  await expect(page.getByRole('status').filter({ hasText: 'Filtre : Bloqués' })).toBeVisible()
  await blockedTile.click()
  await expect(blockedTile).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('Appel de Maman')).toBeVisible()
  await blockedTile.click()
  await expect(page.getByText('Appel de Maman')).toHaveCount(0)

  // Un seul « Autoriser » : le numéro masqué ne peut pas devenir un contact.
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(1)
  await page.getByRole('link', { name: 'Autoriser ce numéro' }).click()
  await expect(page).toHaveURL(new RegExp(`/contact/nouveau\\?phone=%2B261329876543$`))
  await expect(page.getByLabel('Numéro de téléphone')).toHaveValue('+261329876543')
})

test('journal : un contact (member) ne voit pas « Autoriser »', async ({ page }) => {
  await mockApi(page, journalApi('member').handlers)
  await page.goto('/espace/journal')
  await expect(page.getByText('numéro masqué · n’a pas sonné')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(0)
})

test('tuiles : rien de coupé sur un petit écran (320 px)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await mockApi(page, journalApi().handlers)
  await page.goto('/espace/journal')
  for (const label of ['Appels', 'Bloqués', 'Messages', 'Sorties du verrou']) {
    const tile = page.getByRole('button', { name: new RegExp(`${label}$`) })
    await expect(tile).toBeVisible()
    const box = await tile.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  }
  const allow = await page.getByRole('link', { name: 'Autoriser ce numéro' }).boundingBox()
  expect(allow!.x + allow!.width).toBeLessThanOrEqual(320)
  // Aucun défilement horizontal de la page.
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true)
})

test('contact bloqué pendant une plage « école » (NAR-176) : nommé, sans « Autoriser ce numéro »', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const item = { id: '6f1c2b1e-0000-4000-8000-000000000409', kind: 'call_blocked', at: ago(0.1), contactId: '6f1c2b1e-0000-4000-8000-000000000203', name: 'Mamie', phone: '+261321234567', durationS: null }
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [item], next: null, today: { calls: 0, blocked: 1, messages: 0, unlocks: 0 } } })
  })
  await page.goto('/espace/journal')
  await expect(page.getByText('Appel de Mamie bloqué')).toBeVisible()
  await expect(page.getByText('pendant une plage horaire · n’a pas sonné')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(0)
})
