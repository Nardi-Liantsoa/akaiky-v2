import { expect, test, type Page } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Alerte SOS côté parent (NAR-249, maquette 08).
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString(), sosSiren: false, phone: '+261341234567' }
const SOS_ID = '6f1c2b1e-0000-4000-8000-0000000005a1'
const summary = (over = {}) => ({ id: SOS_ID, childId: FY.id, startedAt: new Date(Date.now() - 12_000).toISOString(), endsAt: new Date(Date.now() + 14 * 60_000).toISOString(), cancelledAt: null, handledAt: null, status: 'active', ...over })
const details = (over = {}) => ({
  ...summary(), handledBy: null,
  position: { lat: -18.914561, lng: 47.531234, accuracyM: 15, recordedAt: new Date(Date.now() - 8_000).toISOString() },
  events: [{ kind: 'coming', at: new Date().toISOString(), name: 'Papa', isMe: false }, { kind: 'seen', at: new Date().toISOString(), name: 'Mamie', isMe: false }],
  ...over
})

async function setup(page: Page, { family = FAMILY, alert = details(), handle }: { family?: typeof FAMILY, alert?: object, handle?: () => { status?: number, body?: unknown } } = {}) {
  let current: object = alert
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: family }),
    'GET /api/children': () => ({ body: [FY] }),
    'GET /api/families/me/sos': () => ({ body: { alerts: [summary()] } }),
    [`GET /api/sos/${SOS_ID}`]: () => ({ body: current }),
    [`GET /api/children/${FY.id}/status`]: () => ({ body: { devices: [{ id: 'd1', model: 'Pixel', batteryPct: 61, charging: false, network: 'mobile', simState: 'ready', statusAt: new Date().toISOString(), alerts: [] }] } }),
    [`POST /api/sos/${SOS_ID}/seen`]: () => ({ body: current }),
    [`POST /api/sos/${SOS_ID}/coming`]: () => { current = { ...current, events: [{ kind: 'coming', at: new Date().toISOString(), name: USER.name, isMe: true }] }; return { body: current } },
    [`POST /api/sos/${SOS_ID}/handle`]: () => {
      if (handle) return handle()
      current = { ...current, status: 'handled', handledAt: new Date().toISOString(), handledBy: { name: USER.name, isMe: true }, events: [{ kind: 'handled', at: new Date().toISOString(), name: USER.name, isMe: true }] }
      return { body: current }
    }
  })
  return { calls, set: (a: object) => { current = a } }
}

test('bandeau SOS sur l’accueil, puis l’écran de l’alerte : enfant, heure, batterie, position en direct, qui fait quoi ; « vu » envoyé', async ({ page }) => {
  const { calls } = await setup(page)
  await page.goto('/espace')
  const banner = page.getByRole('region', { name: 'Alertes SOS en cours' }).getByRole('alert')
  await expect(banner).toContainText('Fy a besoin d’aide')
  await expect(banner).toContainText(/il y a \d+ s/)
  await banner.click()
  await expect(page).toHaveURL(new RegExp(`/espace/sos/${SOS_ID}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Fy a besoin d’aide' })).toBeVisible()
  await expect(page.getByText(/^Déclenché à \d\d:\d\d · batterie 61 %$/)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Position -18,91456, 47,53123' })).toContainText(/En direct · mis à jour il y a \d+ s · ±15 m/)
  await expect(page.getByText('Papa arrive')).toBeVisible()
  await expect(page.getByText('Mamie a vu l’alerte')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Appeler Fy' })).toHaveAttribute('href', 'tel:+261341234567')
  await expect(page.getByText('Les autres parents verront que vous vous en occupez.')).toBeVisible()
  // Plein écran : ni onglets ni bandeau sur l'écran de l'alerte.
  await expect(page.getByRole('navigation', { name: /onglets|Navigation/i })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Alertes SOS en cours' })).toHaveCount(0)
  await expect.poll(() => calls.filter((r) => r.method() === 'POST' && r.url().endsWith('/seen')).length).toBe(1)
})

test('« J’arrive » puis « Je prends en charge » : l’écran le dit, le bouton disparaît', async ({ page }) => {
  const { calls } = await setup(page)
  await page.goto(`/espace/sos/${SOS_ID}`)
  await page.getByRole('button', { name: 'J’arrive' }).click()
  await expect(page.getByText('Vous arrivez')).toBeVisible()
  await expect(page.getByRole('button', { name: 'J’arrive' })).toBeDisabled()
  await page.getByRole('button', { name: 'Je prends en charge' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Vous avez pris en charge cette alerte.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Je prends en charge' })).toHaveCount(0)
  expect(calls.filter((r) => r.method() === 'POST' && r.url().endsWith('/handle'))).toHaveLength(1)
})

test('déjà pris en charge par un autre parent : message, puis l’écran le montre ; un contact peut prendre en charge', async ({ page }) => {
  const member = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  const t = await setup(page, {
    family: member,
    handle: () => {
      t.set(details({ status: 'handled', handledAt: new Date().toISOString(), handledBy: { name: 'Maman', isMe: false }, events: [{ kind: 'handled', at: new Date().toISOString(), name: 'Maman', isMe: false }] }))
      return { status: 409, body: { error: 'Déjà pris en charge.', code: 'sos_already_handled' } }
    }
  })
  await page.goto(`/espace/sos/${SOS_ID}`)
  await page.getByRole('button', { name: 'Je prends en charge' }).click()
  await expect(page.getByRole('alert')).toHaveText('Un autre parent vient de la prendre en charge.')
  await expect(page.getByRole('status').filter({ hasText: 'Pris en charge par Maman' })).toBeVisible()
  await expect(page.getByText('Maman s’en occupe')).toBeVisible()
})

test('SOS annulé par l’enfant : l’écran le dit, plus d’action', async ({ page }) => {
  await setup(page, { alert: details({ status: 'cancelled', cancelledAt: new Date().toISOString(), position: null, events: [] }) })
  await page.goto(`/espace/sos/${SOS_ID}`)
  await expect(page.getByRole('status').filter({ hasText: 'Fy a annulé le SOS dans les premières secondes.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Je prends en charge' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Retour à l’accueil' })).toBeVisible()
})

test('alerte inconnue ou d’une autre famille : introuvable, retour à l’accueil', async ({ page }) => {
  await setup(page)
  await page.goto('/espace/sos/6f1c2b1e-0000-4000-8000-0000000005ff')
  await expect(page.getByText('Alerte introuvable.')).toBeVisible()
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click()
  await expect(page).toHaveURL(/\/espace$/)
})

test('une seconde alerte (autre enfant) reste visible en haut de l’écran d’une alerte', async ({ page }) => {
  const MIA = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Mia', avatarColor: 'green' }
  const other = summary({ id: '6f1c2b1e-0000-4000-8000-0000000005a2', childId: MIA.id })
  await setup(page)
  await page.route('**/api/children', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([FY, MIA]) }))
  await page.route('**/api/families/me/sos', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ alerts: [summary(), other] }) }))
  await page.goto(`/espace/sos/${SOS_ID}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Fy a besoin d’aide' })).toBeVisible()
  const banners = page.getByRole('region', { name: 'Alertes SOS en cours' }).getByRole('alert')
  await expect(banners).toHaveCount(1)
  await expect(banners).toContainText('Mia a besoin d’aide')
})

test('alerte échue (15 min) : plus de « J’arrive » ni de prise en charge', async ({ page }) => {
  await setup(page, { alert: details({ status: 'ended' }) })
  await page.goto(`/espace/sos/${SOS_ID}`)
  await expect(page.getByRole('status').filter({ hasText: 'Suivi en direct terminé (15 minutes).' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'J’arrive' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Je prends en charge' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Appeler Fy' })).toBeVisible()
})
