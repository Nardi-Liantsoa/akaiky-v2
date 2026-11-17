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
  const origin = new URL(baseURL!).origin
  const thirdParty: string[] = []
  const fonts: { url: string, status: number }[] = []
  // « request » voit aussi les appels tiers, que mockApi coupe avant toute réponse.
  page.on('request', (r) => { if (new URL(r.url()).origin !== origin) thirdParty.push(r.url()) })
  page.on('response', (r) => { if (r.request().resourceType() === 'font') fonts.push({ url: r.url(), status: r.status() }) })
  await mockApi(page, connected)
  await page.goto('/espace')
  await page.evaluate(() => document.fonts.ready)
  // check() répond vrai même pour une police en échec : on lit son état réel.
  const status = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Nunito').map((f) => f.status))
  expect(status).toEqual(['loaded'])
  expect(thirdParty).toEqual([])
  expect(fonts.length).toBeGreaterThan(0)
  for (const f of fonts) expect(f.status).toBe(200)
})

test('écran étroit en malgache : libellés des onglets contenus dans leur colonne', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.addInitScript(() => { try { localStorage.setItem('akaiky-v2.lang', 'mg') } catch { /* stockage indisponible */ } })
  await mockApi(page, connected)
  await page.goto('/espace')
  const tabs = page.getByRole('navigation', { name: 'Fitetezana lehibe' }).getByRole('link')
  await expect(tabs).toHaveCount(4)
  const overflow = await tabs.evaluateAll((links) => links.some((a) => a.scrollWidth > a.clientWidth))
  expect(overflow).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
