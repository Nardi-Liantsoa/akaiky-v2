// C15 : contacts (NAR-160) et applications autorisées (NAR-143) changés par le parent, vus
// par le téléphone de l'enfant à son relevé suivant (toutes les 30 s).
// Le parent passe par l'interface ; le téléphone est simulé par l'API d'appareil,
// avec l'origine de la WebView Android, comme l'app enfant.
import { test, expect, newClient, api, headingLevel } from './support.mjs'

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
  // Réglages en résumé (NAR-185) : la section s'ouvre par sa ligne.
  await page.goto('/espace/reglages')
  await page.getByRole('navigation', { name: 'Sections des réglages' }).getByRole('link', { name: /^Contacts autorisés/ }).click()
  await expect(page.getByRole('heading', { level: headingLevel(page), name: 'Contacts autorisés' })).toBeVisible()
  await page.getByRole('link', { name: 'Ajouter un contact' }).click()
  await page.getByLabel('Nom affiché').fill('Maman')
  await page.getByLabel('Numéro de téléphone').fill('034 12 345 67')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  // Compteur de la carte (sur ordinateur, la ligne du sommaire le répète à gauche).
  await expect(page.locator('.contacts .count-badge')).toHaveText('1 sur 6')

  // Relevé suivant du téléphone (toutes les 30 s) : la nouvelle version, avec le contact.
  const after = await device(page, 'GET', '/config', { token: accessToken, headers: { 'if-none-match': etag } })
  expect(after.status()).toBe(200)
  expect((await after.json()).contacts.map((c) => [c.name, c.phone])).toEqual([['Maman', '+261341234567']])
})

test('une application autorisée par le parent est vue par le téléphone au relevé suivant (< 1 min) @C15 @C90', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const token = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const { accessToken } = await (await device(page, 'POST', '/pair', { data: { token, model: 'Recette' } })).json()

  // Le téléphone envoie la liste de ses applications.
  const apps = [
    { package: 'com.android.camera2', label: 'Appareil photo' },
    { package: 'com.android.calculator2', label: 'Calculatrice' },
    { package: 'com.android.chrome', label: 'Chrome' }
  ]
  expect((await device(page, 'PUT', '/apps', { token: accessToken, data: { apps } })).status()).toBe(200)
  const before = await device(page, 'GET', '/config', { token: accessToken })
  expect((await before.json()).allowedApps).toEqual([])
  const etag = before.headers().etag

  // Le parent autorise l'appareil photo par l'interface ; le navigateur n'est pas proposé.
  // Réglages en résumé (NAR-185) : la section s'ouvre par sa ligne.
  await page.goto('/espace/reglages')
  await page.getByRole('navigation', { name: 'Sections des réglages' }).getByRole('link', { name: /^Applications autorisées/ }).click()
  await expect(page.getByRole('heading', { level: headingLevel(page), name: 'Applications autorisées' })).toBeVisible()
  const card = page.locator('#applications')
  await card.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await expect(card.getByRole('button', { name: 'Chrome' })).toHaveCount(0)
  await card.getByRole('button', { name: 'Appareil photo' }).click()
  await expect(card.getByText('✓ Appareil photo')).toBeVisible()

  // Relevé suivant du téléphone : nouvelle version, avec l'application.
  const after = await device(page, 'GET', '/config', { token: accessToken, headers: { 'if-none-match': etag } })
  expect(after.status()).toBe(200)
  expect((await after.json()).allowedApps).toEqual([{ package: 'com.android.camera2', label: 'Appareil photo', position: 1 }])
})
