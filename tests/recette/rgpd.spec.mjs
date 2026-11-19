// Suppression de la famille par son parent principal (NAR-177, C21). Le téléphone de l'enfant
// est simulé par l'API d'appareil (origine de la WebView Android), comme pour l'appairage.
import { test, expect, newClient, api, PASSWORD } from './support.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}) }
})

test('le parent principal supprime sa famille : le téléphone est déconnecté et la famille n’existe plus @C21 @C90', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy' })).json()
  expect((await api(page, 'POST', `/children/${fy.id}/contacts`, { name: 'Mamie', phone: '034 76 543 21' })).status()).toBe(201)
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const token = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const paired = await device(page, 'POST', '/pair', { data: { token, model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()
  expect((await device(page, 'GET', '/me', { token: accessToken })).status()).toBe(200)

  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Zone sensible' })).toBeVisible()
  await page.getByRole('button', { name: 'Supprimer la famille' }).click()
  await page.getByLabel('Votre mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Supprimer définitivement la famille' }).click()
  await expect(page.getByText('La famille a été supprimée. Vous pouvez en créer une nouvelle.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toBeVisible()

  expect((await device(page, 'GET', '/me', { token: accessToken })).status()).toBe(401)
  expect((await api(page, 'GET', '/families/me')).status()).toBe(404)
})
