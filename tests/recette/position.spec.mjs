// Position à la demande (NAR-203, NAR-204, NAR-205) sur le vrai serveur : un parent demande
// « Où est Fy ? », le téléphone (simulé par l'API d'appareil, comme son écran) relève et envoie
// sa position, la carte la montre en moins de 30 s ; fond de carte servi par notre serveur,
// aucune requête vers un tiers (garde-fou C90).
import { test, expect, newClient, api } from './support.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}) }
})

test('« Où est Fy ? » : la position arrive sur la carte en moins de 30 s, fond de carte servi par notre serveur @C90', async ({ page }) => {
  await newClient(page, { name: 'Maman Recette' })
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const paired = await device(page, 'POST', '/pair', { data: { token: qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing'], model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()
  // Un premier passage du téléphone : la carte de Fy dit « relié », son menu propose « Où est Fy ? ».
  expect((await device(page, 'GET', '/me', { token: accessToken })).ok()).toBe(true)

  const tiles = []
  page.on('request', (r) => { if (r.url().includes('/api/map/')) tiles.push(r.url()) })
  const t0 = Date.now()
  await page.goto('/espace')
  await page.getByRole('button', { name: /Actions pour Fy/ }).click()
  await page.getByRole('link', { name: 'Où est Fy ?' }).click()
  await expect(page.getByText('Fy verra que vous consultez sa position.')).toBeVisible()

  // Le téléphone voit la demande (son relevé de 15 s), puis envoie un relevé pris après elle.
  await expect.poll(async () => (await (await device(page, 'GET', '/locate', { token: accessToken })).json()).pending, { timeout: 15000 }).toBe(true)
  expect((await device(page, 'POST', '/positions', { token: accessToken, data: { lat: -18.914561, lng: 47.525234, accuracyM: 15, ageS: 0 } })).ok()).toBe(true)

  await expect(page.getByRole('status')).toContainText(/Relevée il y a \d+ s · ±15 m/, { timeout: 15000 })
  await expect(page.getByRole('img', { name: 'Carte : position de Fy' }).locator('canvas')).toBeVisible()
  await expect(page.getByText('© OpenStreetMap')).toBeVisible()
  const elapsed = Date.now() - t0
  expect(elapsed, `position sur la carte en ${elapsed} ms`).toBeLessThan(30000)
  // Le fond vient de notre serveur, et aucune adresse de la carte ne porte la position.
  await expect.poll(() => tiles.some((u) => u.endsWith('/api/map/tiles.pmtiles'))).toBe(true)
  expect(tiles.join('\n')).not.toMatch(/18\.91|47\.52/)
})
