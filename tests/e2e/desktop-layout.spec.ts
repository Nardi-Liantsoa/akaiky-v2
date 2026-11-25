import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'
import { row, summary } from './settings'

// Mise en page de l'ordinateur (NAR-223, maquettes 02 et 05) : accueil en deux colonnes,
// Réglages en maître/détail (liste montée à gauche, section ouverte à droite, adresse par
// section), et rien de changé sous 1024 px.
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: '2026-11-12T10:00:00Z', remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString(), sosSiren: false }
const contacts = { body: { version: 1, max: 6, country: 'MG', contacts: [1, 2, 3].map((n) => ({ id: `6f1c2b1e-0000-4000-8000-00000000020${n}`, childId: FY.id, name: `Contact ${n}`, phone: `+26134000000${n}`, position: n, avatarColor: 'blue', memberUserId: null, memberRole: null })) } }
const api = {
  ...me,
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/children': () => ({ body: [FY] }),
  [`GET /api/children/${FY.id}/contacts`]: () => contacts,
  [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [], next: null } }),
  [`GET /api/children/${FY.id}/message-templates`]: () => ({ body: [1, 2, 3, 4].map((slot) => ({ slot, text: null })) })
}

test.use({ viewport: { width: 1280, height: 800 } })
// NAR223_SHOTS=<dossier> : captures de l'accueil et de Réglages écrites dans ce dossier.
const SHOTS = process.env.NAR223_SHOTS

test('accueil : cartes à gauche, journal du jour de l’enfant à droite', async ({ page }) => {
  await mockApi(page, api)
  await page.goto('/espace')
  const main = page.getByRole('main')
  const card = (await main.locator('ul.cards').boundingBox())!
  const aside = (await main.getByRole('complementary').boundingBox())!
  expect(aside.x).toBeGreaterThan(card.x + card.width)
  expect(Math.abs(aside.y - card.y)).toBeLessThan(80)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accueil-1280.png` })
})

test('Réglages : « Réglages » ouvre la première section à côté de la liste ; changer de section ne relit pas la liste', async ({ page }) => {
  const calls = await mockApi(page, api)
  await page.goto('/espace/reglages')
  // Première section ouverte, sans entrée d'historique de plus.
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Contacts autorisés' })).toBeVisible()
  await expect(row(page, 'Contacts autorisés')).toHaveAttribute('aria-current', 'page')
  const list = (await summary(page).boundingBox())!
  const detail = (await page.getByRole('heading', { level: 2, name: 'Contacts autorisés' }).boundingBox())!
  expect(detail.x).toBeGreaterThan(list.x + list.width)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reglages-1280.png` })

  const templatesReads = () => calls.filter((r) => r.url().includes('/message-templates')).length
  const before = templatesReads()
  await row(page, 'Code parent').click()
  await expect(page).toHaveURL(/\/espace\/reglages\/code-parent$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Code parent' })).toBeVisible()
  await expect(row(page, 'Code parent')).toHaveAttribute('aria-current', 'page')
  await expect(row(page, 'Contacts autorisés')).not.toHaveAttribute('aria-current', 'page')
  // La liste est restée montée : ses résumés n'ont pas été relus.
  expect(templatesReads()).toBe(before)
})

test('sous 1024 px : Réglages reste un résumé, une page par section', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await mockApi(page, api)
  await page.goto('/espace/reglages')
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  await expect(summary(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Contacts autorisés' })).toHaveCount(0)
})
