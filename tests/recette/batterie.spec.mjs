// Batterie faible (NAR-147, C17) : le téléphone de l'enfant est simulé par l'API d'appareil
// (origine de la WebView Android), comme le fait l'app enfant au premier plan. Le parent voit
// l'alerte sur son accueil, et la notification push part vers son jeton (fournisseur factice
// de la recette, PUSH_PROVIDER par défaut hors production) : ligne de la file envoyée, lue par
// le compte propriétaire faute d'accès aux envois en mémoire du serveur.
import { test, expect, newClient, api, asOwner } from './support.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}) }
})

test('la batterie de l’enfant passe sous 15 % : le parent voit l’alerte et reçoit une notification @C17 @C90', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const me = (await (await api(page, 'GET', '/auth/me')).json()).user
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const pairing = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const paired = await device(page, 'POST', '/pair', { data: { token: pairing, model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()
  // Jeton push de la session du parent (son app l'enregistre après la permission, NAR-179).
  expect((await api(page, 'PUT', '/push/token', { token: `fcm-recette-${fy.id}`, platform: 'android', lang: 'fr' })).ok()).toBe(true)

  // Tout va bien d'abord : tuiles, aucune alerte.
  expect((await device(page, 'POST', '/heartbeat', { token: accessToken, data: { batteryPct: 60, charging: false, network: 'mobile', simState: 'ready' } })).ok()).toBe(true)
  await page.goto('/espace')
  const state = page.getByRole('region', { name: 'État du téléphone de Fy' })
  await expect(state.getByRole('definition')).toHaveText(['60 %', 'Mobile', 'Présente'])
  // Ligne d'état de la carte (NAR-192) : pastille « Tout va bien » et dernier passage.
  const card = page.getByRole('button', { name: /^Fy / })
  await expect(card).toContainText(/Tout va bien\s*vu à \d\d:\d\d$/)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // 12 % hors charge : alerte sur l'accueil.
  expect((await device(page, 'POST', '/heartbeat', { token: accessToken, data: { batteryPct: 12, charging: false, network: 'mobile', simState: 'ready' } })).ok()).toBe(true)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Batterie faible')
  await expect(card).toContainText(/À vérifier\s*vu à \d\d:\d\d$/)
  await expect(state.getByRole('definition').first()).toHaveText('12 %')

  // Une notification, une seule, partie vers le jeton du parent (file traitée toutes les 10 s).
  const pushes = () => asOwner(async (db) => (await db.query(
    "SELECT status FROM push_outbox WHERE event = 'battery_low' AND ref = $1 AND owner_key = $2", [fy.id, `user:${me.id}`])).rows)
  await expect.poll(pushes, { timeout: 25000, message: 'notification batterie envoyée' }).toEqual([{ status: 'sent' }])
})
