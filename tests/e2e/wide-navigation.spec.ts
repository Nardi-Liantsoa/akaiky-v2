import { expect, test, type Page } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Navigation parent selon la largeur (NAR-208) : barre du bas sur téléphone, regroupée
// sous la colonne sur tablette, rail à gauche sur ordinateur. Mêmes liens partout.
const api = {
  'GET /api/auth/me': () => ({ body: { user: USER } }),
  'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
  'GET /api/families/me': () => ({ body: FAMILY }),
  'GET /api/children': () => ({ body: [] })
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' })
const box = async (page: Page, name: string) => (await nav(page).getByRole('link', { name, exact: true }).boundingBox())!

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await mockApi(page, api)
  await page.goto('/espace/journal')
  await expect(nav(page).getByRole('link', { name: 'Journal' })).toHaveAttribute('aria-current', 'page')
}

test('téléphone (360 px) : barre du bas sur toute la largeur, comme avant', async ({ page }) => {
  await open(page, 360, 640)
  const bar = (await nav(page).boundingBox())!
  expect(bar.x).toBe(0)
  expect(bar.width).toBe(360)
  expect(bar.y + bar.height).toBe(640)
})

test('tablette (768 px) : barre du bas, onglets regroupés sous la colonne de contenu', async ({ page }) => {
  await open(page, 768, 1024)
  const first = await box(page, 'Accueil'), last = await box(page, 'Famille')
  expect(last.x + last.width - first.x).toBeLessThanOrEqual(720)
  // Centrés : même marge des deux côtés.
  expect(Math.abs(first.x - (768 - (last.x + last.width)))).toBeLessThanOrEqual(1)
  expect(first.y + first.height).toBeGreaterThan(1024 - 70)
})

test('ordinateur (1280 px) : barre latérale pleine hauteur (nom de l’app, onglets, compte), contenu à côté, onglets dans le même ordre', async ({ page }) => {
  await open(page, 1280, 800)
  const rail = (await nav(page).boundingBox())!
  expect(rail.x).toBe(0)
  // Barre latérale de la maquette 02 (NAR-223) : environ 250 px, nom de l'app en tête, compte en bas.
  expect(rail.width).toBeGreaterThanOrEqual(200)
  expect(rail.width).toBeLessThanOrEqual(280)
  expect(rail.height).toBe(800)
  await expect(nav(page).getByRole('link', { name: 'Akaiky, accueil' })).toBeVisible()
  const account = (await nav(page).getByRole('link', { name: /Alice/ }).boundingBox())!
  expect(account.y + account.height).toBeGreaterThan(800 - 100)
  const tops = await Promise.all(['Accueil', 'Journal', 'Réglages', 'Famille'].map(async (n) => (await box(page, n)).y))
  expect(tops).toEqual([...tops].sort((a, b) => a - b))
  for (const n of ['Accueil', 'Famille']) expect((await box(page, n)).height).toBeGreaterThanOrEqual(48)
  const main = (await page.getByRole('main').boundingBox())!
  expect(main.x).toBeGreaterThanOrEqual(rail.x + rail.width)
  // La colonne reste centrée dans la place à droite du rail.
  expect(Math.abs((main.x - (rail.x + rail.width)) - (1280 - (main.x + main.width)))).toBeLessThanOrEqual(1)
  // Clic sur un onglet du rail : même navigation, état actif suivi.
  await nav(page).getByRole('link', { name: 'Famille', exact: true }).click()
  await expect(page).toHaveURL(/\/espace\/famille$/)
  await expect(nav(page).getByRole('link', { name: 'Famille', exact: true })).toHaveAttribute('aria-current', 'page')
  // Page longue : la barre latérale reste à pleine hauteur pendant le défilement (bug de l'audit).
  // Défilement par script : mouse.wheel n'existe pas en WebKit mobile (projet iPhone).
  await page.evaluate(() => window.scrollTo(0, 2000))
  const after = (await nav(page).boundingBox())!
  expect(after.y).toBe(0)
  expect(after.height).toBe(800)
})
