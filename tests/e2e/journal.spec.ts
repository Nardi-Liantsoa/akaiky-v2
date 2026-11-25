import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
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
  await expect(page.getByLabel('Numéro de téléphone')).toHaveValue('+261 32 98 765 43')
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

// NAR-231 : à 360 px (et 320), le numéro d'un appel bloqué tient sur une ligne ; « Autoriser ce numéro »
// passe dessous, sur toute la largeur.
for (const width of [360, 320]) {
  test(`appel bloqué à ${width} px : numéro sur une seule ligne, « Autoriser » dessous`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await mockApi(page, journalApi().handlers)
    await page.goto('/espace/journal')
    const number = page.locator('.item .number', { hasText: '+261 32 98 765 43' })
    await expect(number).toBeVisible()
    const lineHeight = await number.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    expect((await number.boundingBox())!.height).toBeLessThan(lineHeight * 1.5)
    // Séparateur dans le texte (copier-coller), numéro jamais sur l'heure.
    await expect(number.locator('..')).toHaveText('+261 32 98 765 43 · n’a pas sonné')
    const nb = (await number.boundingBox())!
    const time = (await number.locator('xpath=ancestor::li[1]').locator('time').boundingBox())!
    // Le numéro ne passe jamais sous l'heure (qui est au-dessus, à hauteur du titre) ni hors de la carte.
    expect(nb.y >= time.y + time.height || nb.x + nb.width <= time.x).toBe(true)
    expect(nb.x + nb.width).toBeLessThanOrEqual(width - 16)
    const allow = await page.getByRole('link', { name: 'Autoriser ce numéro' }).boundingBox()
    expect(allow!.y).toBeGreaterThan((await number.boundingBox())!.y)
    expect(allow!.height).toBeGreaterThanOrEqual(48)
  })
}

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

test('appel laissé passer par la fenêtre des secours (NAR-196) : marqué, numéro masqué nommé, sans « Autoriser »', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  const items = [
    { id: '6f1c2b1e-0000-4000-8000-000000000410', kind: 'call_in', at: ago(0.1), contactId: null, name: null, phone: '+261329876543', durationS: 95, emergencyWindow: true },
    { id: '6f1c2b1e-0000-4000-8000-000000000411', kind: 'call_in', at: ago(0.2), contactId: null, name: null, phone: null, durationS: null, emergencyWindow: true }
  ]
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items, next: null, today: { calls: 2, blocked: 0, messages: 0, unlocks: 0 } } })
  })
  await page.goto('/espace/journal')
  await expect(page.getByText('Appel de numéro masqué')).toBeVisible()
  await expect(page.getByText('laissé passer : appel aux secours dans les 30 min · 1 min 35 s')).toBeVisible()
  await expect(page.getByText('laissé passer : appel aux secours dans les 30 min', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Autoriser ce numéro' })).toHaveCount(0)
})

// NAR-231 : une icône par tuile ; « Aujourd'hui » défile dans sa carte, les jours suivants restent après.
test('tuiles avec icône ; « Aujourd’hui » défilable sans repousser « Hier »', async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await page.setViewportSize({ width: 360, height: 800 })
  const many = Array.from({ length: 30 }, (_, n) => ({
    id: `6f1c2b1e-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`, kind: 'call_in', at: ago(0.01 * (n + 1)), contactId: 'c1', name: 'Maman', phone: '+261341234567', durationS: 60
  }))
  const api = journalApi()
  api.handlers[`GET /api/children/${FY.id}/journal`] = () => ({ body: { items: [...many, ITEMS[2]], next: null, today: { calls: 30, blocked: 0, messages: 0, unlocks: 0 } } })
  await mockApi(page, api.handlers)
  await page.goto('/espace/journal')
  await expect(page.locator('.summary .tile svg')).toHaveCount(4)
  await expect(page.getByRole('button', { name: /^30 Appels$/ })).toBeVisible()
  const today = page.getByRole('list', { name: 'Aujourd’hui' })
  await expect(today).toHaveAttribute('tabindex', '0')
  const sizes = await today.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  expect(sizes.client).toBeLessThanOrEqual(440)
  // « Hier » n'est pas borné.
  await expect(page.locator('.list.bounded')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Hier' })).toBeVisible()
  // Liste et page au bout : la dernière ligne du jour reste au-dessus de la barre d'onglets.
  await today.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight))
  const last = await today.locator('li').last().boundingBox()
  const bar = await page.getByRole('navigation').last().boundingBox()
  expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y)
  // Un autre filtre : la liste du jour repart en haut.
  await page.evaluate(() => window.scrollTo(0, 0))
  await today.evaluate((el) => { el.scrollTop = 300 })
  await page.getByRole('button', { name: /Appels$/ }).click()
  await expect.poll(() => page.getByRole('list', { name: 'Aujourd’hui' }).evaluate((el) => el.scrollTop)).toBe(0)
  // Tuile active : coche dans la pastille.
  await expect(page.getByRole('button', { name: /Appels$/ })).toHaveAttribute('aria-pressed', 'true')
  // Titre des tuiles retiré de l'écran, gardé pour les lecteurs d'écran.
  await expect(page.getByText('Aujourd’hui en bref')).toHaveClass(/visually-hidden/)
})
