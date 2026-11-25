import { expect, test, type Page } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Accueil parent en cas d'urgence (NAR-193) : cartes rangées par gravité, « Aujourd'hui »
// replié dès deux enfants, carte sans téléphone avec « Relier le téléphone » (gestionnaires),
// alertes regroupées sous un seul bandeau avec « +N ».
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const id = (n: number) => `6f1c2b1e-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const kid = (n: number, firstName: string, paired = true) => ({
  id: id(n), firstName, avatarColor: 'orange', createdAt: `2026-11-1${n}T10:00:00Z`, parentCodeSetAt: null, remoteUnlockUntil: null,
  phoneLastSeenAt: paired ? minutesAgo(1) : null, sosSiren: false
})
type Alert = { kind: 'battery_low' | 'sim_absent' | 'silent', openedAt: string }
const device = (n: number, alerts: Alert[] = [], over: Record<string, unknown> = {}) => ({ devices: [{
  id: `6f1c2b1e-0000-4000-8000-0000000000d${n}`, model: 'Pixel 3a', batteryPct: 57, charging: false, network: 'wifi', simState: 'ready',
  statusAt: minutesAgo(2), alerts, ...over
}] })

// Reçus dans l'ordre : sans téléphone, batterie + carte SIM, silence.
const MIXED = [kid(1, 'Andry', false), kid(2, 'Tiana'), kid(3, 'Fy')]
const MIXED_STATUS: Record<string, () => { status?: number, body?: unknown }> = {
  [id(2)]: () => ({ body: device(2, [{ kind: 'battery_low', openedAt: minutesAgo(10) }, { kind: 'sim_absent', openedAt: minutesAgo(20) }], { batteryPct: 9, simState: 'absent' }) }),
  [id(3)]: () => ({ body: device(3, [{ kind: 'silent', openedAt: minutesAgo(30) }], { statusAt: minutesAgo(90) }) })
}

async function home(page: Page, kids: ReturnType<typeof kid>[], status: Record<string, () => { status?: number, body?: unknown }> = {}, role = 'owner') {
  const handlers: Parameters<typeof mockApi>[1] = {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, role } }),
    'GET /api/children': () => ({ body: kids })
  }
  for (const k of kids) {
    handlers[`GET /api/children/${k.id}/journal`] = () => ({ body: { items: [], next: null } })
    const s = status[k.id]
    if (s) handlers[`GET /api/children/${k.id}/status`] = s
  }
  return mockApi(page, handlers)
}
const names = (page: Page) => page.locator('li.child .name')

test('3 enfants à 360×640 : le silence en haut, visible sans défiler ; ligne « Aujourd’hui » vers le journal de sa carte', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await home(page, MIXED, MIXED_STATUS)
  await page.goto('/espace')
  await expect(names(page)).toHaveText(['Fy', 'Tiana', 'Andry'])
  const top = page.locator('li.child').first()
  await expect(top.getByRole('alert')).toContainText('Le téléphone ne répond plus')
  await expect(top).toBeInViewport({ ratio: 1 })
  // Maquette 01 (NAR-227) : une ligne « Aujourd'hui · N appels, N bloqués › » par carte reliée,
  // aucune sur la carte sans téléphone ; elle ouvre le journal de CET enfant.
  const lines = page.getByRole('link', { name: /^Aujourd’hui/ })
  await expect(lines).toHaveCount(2)
  const line = top.getByRole('link', { name: /^Aujourd’hui/ })
  expect((await line.boundingBox())?.height).toBeGreaterThanOrEqual(48)
  await line.click()
  await expect(page).toHaveURL(/\/espace\/journal$/)
  await page.goBack()
  await expect(page.locator('li.child').first().getByRole('button', { name: /^Fy / })).toHaveAttribute('aria-current', 'true')
})

test('relecture aux mêmes états, ou en échec : l’ordre ne bouge pas', async ({ page }) => {
  let down = false
  const status = Object.fromEntries(Object.entries(MIXED_STATUS).map(([k, f]) => [k, () => (down ? { status: 503, body: { error: 'x' } } : f())]))
  const calls = await home(page, MIXED, status)
  await page.goto('/espace')
  await expect(names(page)).toHaveText(['Fy', 'Tiana', 'Andry'])
  for (const fail of [false, true]) {
    down = fail
    const before = calls.filter((r) => r.url().endsWith('/status')).length
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => calls.filter((r) => r.url().endsWith('/status')).length).toBeGreaterThanOrEqual(before + 2)
    await expect(names(page)).toHaveText(['Fy', 'Tiana', 'Andry'])
  }
})

test('un seul enfant : ligne « Aujourd’hui » vers son journal, sans rien à déplier', async ({ page }) => {
  await home(page, [kid(3, 'Fy')], { [id(3)]: () => ({ body: device(3) }) })
  await page.goto('/espace')
  await expect(page.getByRole('link', { name: /^Aujourd’hui/ })).toBeVisible()
  await expect(page.locator('[aria-expanded]')).toHaveCount(0)
})

test('sans téléphone : un gestionnaire relie le téléphone en un toucher, sans journal', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await home(page, [kid(1, 'Andry', false)])
  await page.goto('/espace')
  await expect(page.getByText('Reliez son téléphone en 3 étapes pour l’appeler et recevoir ses alertes.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aujourd’hui' })).toHaveCount(0)
  const pair = page.getByRole('button', { name: 'Relier le téléphone' })
  const box = await pair.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(48)
  await pair.click()
  await expect(page).toHaveURL(new RegExp(`/espace/enfant/${id(1)}/telephone$`))
})

test('sans téléphone, en malgache : « Ampifandraiso ny finday »', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('akaiky-v2.lang', 'mg'))
  await home(page, [kid(1, 'Andry', false)])
  await page.goto('/espace')
  await expect(page.getByRole('button', { name: 'Ampifandraiso ny finday' })).toBeVisible()
})

test('sans téléphone : un contact (member) ne voit que le texte', async ({ page }) => {
  await home(page, [kid(1, 'Andry', false), kid(3, 'Fy')], { [id(3)]: () => ({ body: device(3) }) }, 'member')
  await page.goto('/espace')
  await expect(page.getByText('Reliez son téléphone en 3 étapes pour l’appeler et recevoir ses alertes.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Relier le téléphone' })).toHaveCount(0)
})

test('alertes regroupées : un seul bandeau, le plus grave ; « +2 » déplie les autres', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await home(page, [kid(3, 'Fy')], { [id(3)]: () => ({ body: device(3, [
    { kind: 'battery_low', openedAt: minutesAgo(10) }, { kind: 'silent', openedAt: minutesAgo(5) }, { kind: 'sim_absent', openedAt: minutesAgo(20) }
  ], { batteryPct: 9, simState: 'absent' }) }) })
  await page.goto('/espace')
  const banner = page.getByRole('alert')
  await expect(banner).toHaveCount(1)
  await expect(banner.locator('strong')).toHaveText('Le téléphone ne répond plus')
  await expect(page.locator('.banner:visible')).toHaveCount(1)
  const more = page.getByRole('button', { name: '+2 autres alertes' })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  const box = await more.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(48)
  expect(box?.width).toBeGreaterThanOrEqual(48)
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  const others = page.locator(`#${await more.getAttribute('aria-controls')}`)
  await expect(others.locator('strong')).toHaveText(['Pas de carte SIM', 'Batterie faible · 9 %'])
  await expect(page.locator('.banner:visible')).toHaveCount(3)
  await more.click()
  await expect(page.locator('.banner:visible')).toHaveCount(1)
})

test('une seule alerte : pas de « +N »', async ({ page }) => {
  await home(page, [kid(3, 'Fy')], { [id(3)]: () => ({ body: device(3, [{ kind: 'battery_low', openedAt: minutesAgo(10) }], { batteryPct: 9 }) }) })
  await page.goto('/espace')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.locator('.more-alerts')).toHaveCount(0)
})

test('ligne « Aujourd’hui » de la deuxième carte : le journal ouvert est celui de cet enfant', async ({ page }) => {
  await home(page, MIXED, MIXED_STATUS)
  await page.goto('/espace')
  await expect(names(page)).toHaveText(['Fy', 'Tiana', 'Andry'])
  const tiana = page.locator('li.child').nth(1)
  await tiana.getByRole('link', { name: /^Aujourd’hui/ }).click()
  await expect(page).toHaveURL(/\/espace\/journal$/)
  await page.goBack()
  await expect(page.locator('li.child', { hasText: 'Tiana' }).getByRole('button', { name: /^Tiana / })).toHaveAttribute('aria-current', 'true')
})

test('focus clavier dans la liste : l’ordre attend que le focus en sorte', async ({ page }) => {
  let calm = false
  const status = { ...MIXED_STATUS, [id(3)]: () => (calm ? { body: device(3) } : MIXED_STATUS[id(3)]()) }
  const calls = await home(page, MIXED, status)
  await page.goto('/espace')
  await expect(names(page)).toHaveText(['Fy', 'Tiana', 'Andry'])
  const toggle = page.locator('li.child').nth(1).getByRole('link', { name: /^Aujourd’hui/ })
  await toggle.focus()
  calm = true
  const before = calls.filter((r) => r.url().endsWith('/status')).length
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => calls.filter((r) => r.url().endsWith('/status')).length).toBeGreaterThanOrEqual(before + 2)
  await expect(page.locator('li.child').first().getByRole('alert')).toHaveCount(0)
  await expect(names(page)).toHaveText(['Fy', 'Tiana', 'Andry'])
  await expect(toggle).toBeFocused()
  await toggle.blur()
  await expect(names(page)).toHaveText(['Tiana', 'Fy', 'Andry'])
})
