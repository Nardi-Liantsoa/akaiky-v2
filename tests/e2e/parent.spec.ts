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

test('police servie par l’application, aucun appel à un tiers', async ({ page, baseURL }) => {
  const fonts: { url: string, status: number }[] = []
  page.on('response', (r) => { if (r.request().resourceType() === 'font') fonts.push({ url: r.url(), status: r.status() }) })
  await mockApi(page, connected)
  await page.goto('/espace')
  await page.evaluate(() => document.fonts.ready)
  // check() répond vrai même pour une police en échec : on lit son état réel.
  const status = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Nunito').map((f) => f.status))
  expect(status).toEqual(['loaded'])
  expect(fonts.length).toBeGreaterThan(0)
  for (const f of fonts) {
    expect(new URL(f.url).origin).toBe(new URL(baseURL!).origin)
    expect(f.status).toBe(200)
  }
})
