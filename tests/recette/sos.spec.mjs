// SOS en ligne (NAR-248, NAR-249 ; C10, C13). Le téléphone de l'enfant est simulé par l'API
// d'appareil, comme l'écran de l'enfant après l'appui de 3 s : ouverture de l'alerte, puis sa
// position. Deux parents, chacun dans son navigateur, sur l'accueil de l'app.
import { test, expect, newClient, api, mails } from './support.mjs'
import { state } from './env.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}) }
})

async function secondParent(browser, ownerPage, role) {
  const context = await browser.newContext({ baseURL: state().origin, locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: ownerPage.viewportSize() ?? undefined })
  const page = await context.newPage()
  const guest = await newClient(page, { name: 'Papa Recette' })
  expect((await api(ownerPage, 'POST', '/families/me/invitations', { email: guest.email, role })).ok()).toBe(true)
  let token
  await expect.poll(() => (token = /#invite=([A-Za-z0-9_-]+)/.exec(mails(guest.email).findLast((m) => m.text.includes('#invite='))?.text ?? '')?.[1])).toBeTruthy()
  expect((await api(page, 'POST', '/invitations/accept', { token })).ok()).toBe(true)
  return { context, page, ...guest }
}

test('un SOS du téléphone arrive en moins de 10 s, avec sa position, chez chaque parent ; la prise en charge est vue par l’autre @C10 @C13 @C90', async ({ page, browser }) => {
  await newClient(page, { name: 'Maman Recette' })
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const paired = await device(page, 'POST', '/pair', { data: { token: qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing'], model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()
  // Le second parent est un contact (rôle member) : il reçoit l'alerte et peut la prendre en charge.
  const papa = await secondParent(browser, page, 'member')
  try {
    await page.goto('/espace')
    await papa.page.goto('/espace')
    await expect(page.getByRole('heading', { level: 1, name: 'Vos enfants' })).toBeVisible()
    await expect(papa.page.getByRole('heading', { level: 1, name: 'Vos enfants' })).toBeVisible()

    // Appui de 3 s sur le téléphone : alerte ouverte, puis la première position.
    const t0 = Date.now()
    const opened = await device(page, 'POST', '/sos', { token: accessToken, data: { clientId: crypto.randomUUID() } })
    expect(opened.status()).toBe(201)
    const { id } = await opened.json()
    expect((await device(page, 'POST', `/sos/${id}/positions`, { token: accessToken, data: { lat: -18.914561, lng: 47.531234, accuracyM: 15, ageS: 1 } })).ok()).toBe(true)

    // Chez chaque parent : le bandeau, puis l'alerte avec la position, en moins de 10 s.
    for (const p of [page, papa.page]) {
      const banner = p.getByRole('region', { name: 'Alertes SOS en cours' }).getByRole('alert')
      await expect(banner).toContainText('Fy a besoin d’aide', { timeout: 9000 })
      await banner.click()
      await expect(p.getByRole('status').filter({ hasText: 'Position -18,91456, 47,53123' })).toContainText('±15 m')
    }
    const elapsed = Date.now() - t0
    expect(elapsed, `alerte avec la position chez les deux parents en ${elapsed} ms`).toBeLessThan(10000)

    // C13 : Papa (contact) la prend en charge ; Maman le voit sans rien toucher.
    await papa.page.getByRole('button', { name: 'Je prends en charge' }).click()
    await expect(papa.page.getByRole('status').filter({ hasText: 'Vous avez pris en charge cette alerte.' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Pris en charge par Papa Recette' })).toBeVisible()
    await expect(page.getByText('Papa Recette s’en occupe')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Je prends en charge' })).toHaveCount(0)
    // La position n'est plus envoyée une fois l'alerte prise en charge.
    expect((await device(page, 'POST', `/sos/${id}/positions`, { token: accessToken, data: { lat: -18.9, lng: 47.5, accuracyM: 15, ageS: 1 } })).status()).toBe(409)
  } finally {
    await papa.context.close()
  }
})
