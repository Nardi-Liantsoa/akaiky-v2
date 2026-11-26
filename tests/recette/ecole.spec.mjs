// Plage « école » (NAR-148, C16 partie écran de l'enfant). Partie appels (NAR-176) : filtre
// natif, vérifié sur émulateur (SchoolScheduleTest.kt et procédure de la PR #27).
// Le parent crée la plage par l'interface ; le téléphone est simulé par l'API d'appareil
// (origine de la WebView Android) et sa configuration passe par la règle même de l'écran
// de l'enfant (src/lib/schedule.ts), à heure figée.
import { test, expect, newClient, api, headingLevel } from './support.mjs'
import { activeWindow, visibleContacts } from '../../src/lib/schedule.ts'

const PHONE = { origin: 'https://localhost' }
const device = (page, method, path, { token, data, headers = {} } = {}) => page.request.fetch(`/api/device${path}`, {
  method, data, headers: { ...PHONE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }
})
// Heure de Madagascar (UTC+3) ; 2026-11-16 est un lundi.
const at = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, 16 + day, hh - 3, mm))

test('pendant la plage « école », le téléphone ne montre que les parents et le SOS ; elle se lève seule à la fin @C16 @C90', async ({ page }) => {
  await newClient(page)
  expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
  const me = (await (await api(page, 'GET', '/auth/me')).json()).user
  const fy = await (await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).json()
  expect((await api(page, 'POST', `/children/${fy.id}/contacts`, { name: 'Maman', phone: '034 12 345 67', memberUserId: me.id })).status()).toBe(201)
  expect((await api(page, 'POST', `/children/${fy.id}/contacts`, { name: 'Mamie', phone: '034 76 543 21' })).status()).toBe(201)
  const qr = await (await api(page, 'POST', `/children/${fy.id}/pairing`, {})).json()
  const token = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
  const paired = await device(page, 'POST', '/pair', { data: { token, model: 'Recette' } })
  expect(paired.status()).toBe(201)
  const { accessToken } = await paired.json()
  const etag = (await device(page, 'GET', '/config', { token: accessToken })).headers().etag

  // Le parent crée la plage par l'interface (lun–ven, 8:00–16:00 par défaut).
  // Réglages en résumé (NAR-185) : la section s'ouvre par sa ligne.
  await page.goto('/espace/reglages')
  await page.getByRole('navigation', { name: 'Sections des réglages' }).getByRole('link', { name: /^Plages horaires/ }).click()
  await expect(page.getByRole('heading', { level: headingLevel(page), name: 'Plages horaires' })).toBeVisible()
  const card = page.locator('#plages')
  await card.getByRole('button', { name: 'Ajouter une plage' }).click()
  await card.getByRole('button', { name: 'Enregistrer la plage' }).click()
  await expect(card.getByText('Lun–Ven · 8:00–16:00 · parents + SOS')).toBeVisible()
  // Retour au résumé : sa ligne dit la plage enregistrée (sur ordinateur, le sommaire reste à gauche,
  // sans lien de retour : la ligne est relue sans navigation).
  if (headingLevel(page) === 1) await page.getByRole('link', { name: 'Retour aux réglages' }).click()
  await expect(page.getByRole('navigation', { name: 'Sections des réglages' }).getByRole('link', { name: /^Plages horaires/ })).toContainText('École · Lun–Ven 8:00–16:00')

  // Relevé suivant du téléphone : nouvelle version, avec la plage et les contacts « parents ».
  const res = await device(page, 'GET', '/config', { token: accessToken, headers: { 'if-none-match': etag } })
  expect(res.status()).toBe(200)
  const config = await res.json()
  const show = (when) => visibleContacts(config.contacts, activeWindow(when, config.schedules, config.timezone)).map((c) => c.name)
  // Lundi 10:00 : seule Maman (parent) ; fin annoncée à 16:00.
  expect(show(at(0, 10))).toEqual(['Maman'])
  expect(activeWindow(at(0, 10), config.schedules, config.timezone)?.until).toEqual(at(0, 16))
  // 16:00 et samedi : tout revient.
  expect(show(at(0, 16))).toEqual(['Maman', 'Mamie'])
  expect(show(at(5, 10))).toEqual(['Maman', 'Mamie'])
})
