// Messages rapides de l'enfant (NAR-150, C14). Le téléphone est simulé par l'API
// d'appareil (origine de la WebView Android) ; le parent passe par l'interface. La
// notification push viendra avec NAR-141 : ici, le message s'affiche dans l'app parent.
import { test, expect, newClient, api } from './support.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}) }
})

test('un message rapide envoyé par l’enfant arrive chez les parents, et l’enfant voit qu’il a été lu @C14 @C90', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy' })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const token = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const paired = await device(page, 'POST', '/pair', { data: { token, model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()

  const id = crypto.randomUUID()
  const sent = await device(page, 'POST', '/messages', { token: accessToken, data: { id, slot: 1, sentAt: new Date().toISOString() } })
  expect(sent.status()).toBe(200)

  await page.goto('/espace')
  await expect(page.getByRole('heading', { name: 'Messages de Fy' })).toBeVisible()
  await expect(page.getByText('Je suis arrivé')).toBeVisible()

  // Affiché chez le parent : vu, et le téléphone le sait.
  await expect.poll(async () => (await (await device(page, 'GET', '/messages', { token: accessToken })).json())[0].readBy.length).toBe(1)
})
