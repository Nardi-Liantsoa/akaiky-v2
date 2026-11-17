import { expect, test } from '@playwright/test'
import { mockApi, USER } from './mock'

const connected = { 'GET /api/auth/me': () => ({ body: { user: USER } }) }

test('parent connecté : quatre onglets, sans rechargement, onglet actif signalé', async ({ page }) => {
  await mockApi(page, connected)
  await page.goto('/espace')
  const tabs = page.getByRole('navigation', { name: 'Navigation principale' })
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page')

  // Un marqueur posé sur window survit seulement si la page n'est pas rechargée.
  await page.evaluate(() => { (window as unknown as { marker: number }).marker = 1 })
  for (const [name, path] of [['Journal', '/espace/journal'], ['Réglages', '/espace/reglages'], ['Famille', '/espace/famille'], ['Accueil', '/espace']]) {
    await tabs.getByRole('link', { name }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1)
  }
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1)
})

test('police servie par l’application, aucun appel à un tiers', async ({ page }) => {
  const fonts: string[] = []
  page.on('request', (r) => { if (r.resourceType() === 'font') fonts.push(r.url()) })
  await mockApi(page, connected)
  await page.goto('/espace')
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('900 16px Nunito'))).toBe(true)
  expect(fonts.length).toBeGreaterThan(0)
  for (const url of fonts) expect(new URL(url).origin).toBe('http://127.0.0.1:4173')
})
