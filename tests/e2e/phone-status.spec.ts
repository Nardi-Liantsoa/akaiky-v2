import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// État du téléphone sur l'accueil parent (NAR-147) : tuiles, bandeau d'alerte, « vu il y a ».
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = '6f1c2b1e-0000-4000-8000-000000000101'
const kid = { id: FY, firstName: 'Fy', avatarColor: 'orange', createdAt: '2026-11-11T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString() }
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const device = (over: Record<string, unknown> = {}) => ({
  id: '6f1c2b1e-0000-4000-8000-0000000000d1', model: 'Pixel 3a', batteryPct: 57, charging: false, network: 'wifi', simState: 'ready',
  statusAt: minutesAgo(2), alerts: [], ...over
})

async function home(page: import('@playwright/test').Page, status: () => { status?: number, body?: unknown }) {
  return mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [kid] }),
    [`GET /api/children/${FY}/journal`]: () => ({ body: { items: [], next: null } }),
    [`GET /api/children/${FY}/status`]: status
  })
}

test('tuiles Batterie · Réseau · Carte SIM et « vu il y a 2 minutes »', async ({ page }) => {
  await home(page, () => ({ body: { devices: [device()] } }))
  await page.goto('/espace')
  const state = page.getByRole('region', { name: 'État du téléphone de Fy' })
  await expect(state.getByRole('definition').nth(0)).toHaveText('57 %')
  await expect(state.getByRole('term')).toHaveText(['Batterie', 'Réseau', 'Carte SIM'])
  await expect(state.getByRole('definition')).toHaveText(['57 %', 'Wi-Fi', 'Présente'])
  await expect(state.getByText('Vu il y a 2 minutes')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('batterie faible : bandeau d’alerte, et les textes en malgache', async ({ page }) => {
  await home(page, () => ({ body: { devices: [device({ batteryPct: 12, network: 'mobile', alerts: [{ kind: 'battery_low', openedAt: minutesAgo(5) }] })] } }))
  await page.goto('/espace')
  const banner = page.getByRole('alert')
  await expect(banner).toContainText('Batterie faible sur le téléphone de Fy')
  await expect(banner).toContainText('Signalé il y a 5 minutes')
  await expect(page.getByRole('definition').nth(0)).toHaveText('12 %')
  await page.evaluate(() => localStorage.setItem('akaiky-v2.lang', 'mg'))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('Efa ho lany ny bateria-n’ny findain’i Fy')
  await expect(page.getByText('Hita 2 minitra lasa izay')).toBeVisible()
})

test('relecture en échec : les derniers relevés restent ; jamais de signal : message', async ({ page }) => {
  let down = false
  const calls = await home(page, () => down ? { status: 503, body: { error: 'Indisponible.' } } : { body: { devices: [device({ statusAt: null })] } })
  await page.goto('/espace')
  await expect(page.getByText('Pas encore de nouvelles du téléphone')).toBeVisible()
  down = true
  const before = calls.filter((r) => r.url().endsWith('/status')).length
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => calls.filter((r) => r.url().endsWith('/status')).length).toBeGreaterThan(before)
  await expect(page.getByText('Pas encore de nouvelles du téléphone')).toBeVisible()
  await expect(page.getByText('État du téléphone indisponible pour le moment.')).toHaveCount(0)
})
