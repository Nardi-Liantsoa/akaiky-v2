// Positions purgées à 30 jours (NAR-203, C20). Le téléphone de l'enfant est simulé par l'API
// d'appareil (origine de la WebView Android). Horloge simulée par le compte propriétaire : la
// position est vieillie en base, puis le tour quotidien de la purge (purge_expired(), lancé par
// server/src/jobs.js) est joué tout de suite au lieu d'attendre l'heure suivante. La
// vérification passe par le produit : la position n'est plus rendue au parent.
import { test, expect, newClient, api, asOwner } from './support.mjs'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}) }
})
const purgeNow = () => asOwner(async (db) => {
  await db.query("UPDATE job_runs SET started_at = NULL WHERE job = 'retention'")
  return (await db.query('SELECT purge_expired() AS r')).rows[0].r
})

test('une position de plus de 30 jours est supprimée, une plus récente reste @C20', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const pairing = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const paired = await device(page, 'POST', '/pair', { data: { token: pairing, model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()

  // Le parent demande la position, le téléphone répond par un relevé unique.
  expect((await api(page, 'POST', `/children/${fy.id}/locate`)).ok()).toBe(true)
  expect((await device(page, 'POST', '/positions', { token: accessToken, data: { lat: -18.8792, lng: 47.5079, accuracyM: 15, ageS: 3 } })).ok()).toBe(true)
  const shown = async () => (await (await api(page, 'GET', `/children/${fy.id}/position`)).json()).position
  expect(await shown()).toMatchObject({ lat: -18.8792, lng: 47.5079, accuracyM: 15 })

  // 29 jours plus tard : gardée.
  await asOwner((db) => db.query("UPDATE positions SET received_at = now() - interval '29 days', recorded_at = now() - interval '29 days' WHERE child_id = $1", [fy.id]))
  await purgeNow()
  expect(await shown()).toMatchObject({ accuracyM: 15 })

  // 31 jours : supprimée.
  await asOwner((db) => db.query("UPDATE positions SET received_at = now() - interval '31 days', recorded_at = now() - interval '31 days' WHERE child_id = $1", [fy.id]))
  expect((await purgeNow()).positions).toBeGreaterThanOrEqual(1)
  expect(await shown()).toBeNull()
})
