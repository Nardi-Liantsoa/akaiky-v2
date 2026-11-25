import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Téléphone étroit (360 px, NAR-207) : aucun écran parent ne défile de côté, les
// pastilles de couleur tiennent sur une ligne, une ligne de contact garde ses actions.
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: '2026-11-12T10:00:00Z', remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false, phone: '+261341234567' }
const contact = (n: number, name: string, phone: string, memberRole: string | null) => ({
  id: `6f1c2b1e-0000-4000-8000-0000000002${n}0`, childId: FY.id, name, phone, position: n, avatarColor: 'orange',
  memberUserId: memberRole ? USER.id : null, memberRole
})
const CONTACTS = [contact(1, 'Maman', '+261341234567', 'owner'), contact(2, 'Dadabe Rakotomalala', '+261331234567', null)]
const api = {
  'GET /api/auth/me': () => ({ body: { user: USER } }),
  'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/children': () => ({ body: [FY] }),
  [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: CONTACTS } }),
  // Un texte modifié : le bouton « Texte par défaut » s'affiche (débordement d'avant).
  [`GET /api/children/${FY.id}/message-templates`]: () => ({ body: [{ slot: 1, text: 'Viens me chercher à l’école' }, { slot: 2, text: null }, { slot: 3, text: null }, { slot: 4, text: null }] }),
  [`GET /api/children/${FY.id}/schedules`]: () => ({ body: [{ id: '6f1c2b1e-0000-4000-8000-000000000301', label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }] }),
  // Journal rempli (message, appel bloqué d'un inconnu, appels) : les lignes les plus larges.
  [`GET /api/children/${FY.id}/journal`]: () => ({
    body: {
      items: [
        { id: '6f1c2b1e-0000-4000-8000-000000000501', kind: 'message', at: '2026-11-24T09:05:00Z', slot: 1, readBy: [{ name: 'Maman', readAt: '2026-11-24T09:06:00Z' }], readByMe: true },
        { id: '6f1c2b1e-0000-4000-8000-000000000502', kind: 'call_blocked', at: '2026-11-24T08:40:00Z', contactId: null, name: null, phone: '+261329876543', durationS: null },
        { id: '6f1c2b1e-0000-4000-8000-000000000503', kind: 'call_in', at: '2026-11-24T07:02:00Z', contactId: CONTACTS[1].id, name: 'Dadabe Rakotomalala', phone: '+261331234567', durationS: 134 },
        { id: '6f1c2b1e-0000-4000-8000-000000000504', kind: 'unlock', at: '2026-11-23T17:30:00Z', source: 'code', durationS: 900 }
      ],
      next: null
    }
  }),
  [`GET /api/children/${FY.id}/apps`]: () => ({
    body: { max: 4, inventory: [{ package: 'com.android.camera2', label: 'Appareil photo', icon: null, allowed: true }, { package: 'com.example.calculatrice.scientifique', label: 'Calculatrice scientifique', icon: null, allowed: false }], allowed: [{ package: 'com.android.camera2', label: 'Appareil photo', position: 1 }] }
  }),
  [`GET /api/children/${FY.id}/devices`]: () => ({ body: [] })
}
const PAGES = [
  '/espace', '/espace/famille', '/espace/journal', '/espace/compte/securite',
  '/espace/enfant/nouveau', `/espace/enfant/${FY.id}`, `/espace/enfant/${FY.id}/telephone`,
  '/espace/reglages', '/espace/reglages/contacts', '/espace/reglages/applications', '/espace/reglages/code-parent',
  '/espace/reglages/plages', '/espace/reglages/sos', '/espace/reglages/messages',
  `/espace/reglages/enfant/${FY.id}/contact/nouveau`, `/espace/reglages/enfant/${FY.id}/contact/${CONTACTS[0].id}`
]

test.use({ viewport: { width: 360, height: 640 } })

for (const path of PAGES) {
  test(`${path} : rien ne dépasse à 360 px`, async ({ page }) => {
    await mockApi(page, api)
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
    expect(scroll, `largeur de ${path}`).toBeLessThanOrEqual(inner)
  })
}

test('formulaires enfant et contact : lien retour en tête et jamais « Annuler » (docs/DESIGN.md), pastilles sur une ligne', async ({ page }) => {
  await mockApi(page, api)
  for (const [path, back] of [[`/espace/enfant/${FY.id}`, 'Retour à l’accueil'], [`/espace/reglages/enfant/${FY.id}/contact/${CONTACTS[0].id}`, 'Retour aux contacts autorisés']]) {
    await page.goto(path)
    await expect(page.getByRole('link', { name: back })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Annuler' })).toHaveCount(0)
    const swatches = page.getByRole('radio')
    await expect(swatches).toHaveCount(5)
    const boxes = await Promise.all((await swatches.all()).map((s) => s.locator('..').boundingBox()))
    expect(new Set(boxes.map((b) => Math.round(b!.y))).size, `pastilles de ${path}`).toBe(1)
    for (const b of boxes) expect(Math.min(b!.width, b!.height)).toBeGreaterThanOrEqual(48)
  }
})

test('ligne de contact : la fiche s’ouvre par la ligne, Monter et Descendre restent sur la ligne, cibles de 48 px', async ({ page }) => {
  await mockApi(page, api)
  await page.goto('/espace/reglages/contacts')
  const item = page.getByRole('listitem').filter({ hasText: 'Dadabe Rakotomalala' })
  const open = item.getByRole('link', { name: 'Modifier Dadabe Rakotomalala' })
  // Dernier de la liste : seule « Monter » (la flèche impossible est masquée, NAR-222).
  const up = item.getByRole('button', { name: /^Monter/ })
  const row = (await item.boundingBox())!
  for (const target of [open, ...(await item.getByRole('button', { name: /^(Monter|Descendre)/ }).all())]) {
    const b = (await target.boundingBox())!
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(48)
    // Dans la hauteur de la ligne du contact, pas sur une ligne à part sous lui.
    expect(b.y).toBeGreaterThanOrEqual(row.y)
    expect(b.y + b.height).toBeLessThanOrEqual(row.y + row.height + 0.5)
  }
  expect((await open.boundingBox())!.x + (await open.boundingBox())!.width).toBeLessThanOrEqual((await up.boundingBox())!.x)
  // Le numéro, jamais coupé, ne passe pas sous la flèche.
  const phone = (await item.getByText('+261 33 12 345 67').boundingBox())!
  expect(phone.x + phone.width).toBeLessThanOrEqual((await up.boundingBox())!.x)
  await open.click()
  await expect(page.getByLabel('Nom affiché')).toHaveValue('Dadabe Rakotomalala')
})

test('320 px (police agrandie, petit écran) : le numéro, jamais coupé, ne passe pas sous Monter et Descendre', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await mockApi(page, api)
  await page.goto('/espace/reglages/contacts')
  const item = page.getByRole('listitem').filter({ hasText: 'Dadabe Rakotomalala' })
  const phone = (await item.getByText('+261 33 12 345 67').boundingBox())!
  for (const button of await item.getByRole('button').all()) {
    const b = (await button.boundingBox())!
    const apart = phone.x + phone.width <= b.x || b.y >= phone.y + phone.height || b.y + b.height <= phone.y
    expect(apart, 'numéro et bouton séparés').toBe(true)
  }
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
  expect(scroll).toBeLessThanOrEqual(inner)
})
