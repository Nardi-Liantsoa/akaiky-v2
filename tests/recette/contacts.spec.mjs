// Contacts autorisés vus par le téléphone de l'enfant (NAR-160, C15 partie contacts ;
// le critère reste « (prévu) » jusqu'aux applications autorisées, NAR-143).
// Le parent passe par l'interface ; le téléphone est simulé par l'API d'appareil,
// avec l'origine de la WebView Android, comme l'app enfant.
import { test, expect, newClient, api } from './support.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data, headers = {} } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }
})

test('un contact ajouté par le parent est vu par le téléphone au relevé suivant (< 1 min) @C15 @C90', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const token = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const paired = await device(page, 'POST', '/pair', { data: { token, model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()

  const before = await device(page, 'GET', '/config', { token: accessToken })
  expect((await before.json()).contacts).toEqual([])
  const etag = before.headers().etag

  // Le parent ajoute un contact par l'interface.
  await page.goto('/espace/reglages')
  await page.getByRole('link', { name: '+ Ajouter un contact' }).click()
  await page.getByLabel('Nom affiché').fill('Maman')
  await page.getByLabel('Numéro de téléphone').fill('034 12 345 67')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages$/)

  // Relevé suivant du téléphone (toutes les 30 s) : la nouvelle version, avec le contact.
  const after = await device(page, 'GET', '/config', { token: accessToken, headers: { 'if-none-match': etag } })
  expect(after.status()).toBe(200)
  expect((await after.json()).contacts.map((c) => [c.name, c.phone])).toEqual([['Maman', '+261341234567']])
})
