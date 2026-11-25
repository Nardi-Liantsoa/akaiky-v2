import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// État du téléphone sur l'accueil parent (NAR-147) : tuiles, bandeau d'alerte ; ligne d'état
// de la carte (NAR-192) : pastille à quatre niveaux (couleur, icône, texte) et « vu à ».
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = '6f1c2b1e-0000-4000-8000-000000000101'
const kid = { id: FY, firstName: 'Fy', avatarColor: 'orange', createdAt: '2026-11-11T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString() }
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
const device = (over: Record<string, unknown> = {}) => ({
  id: '6f1c2b1e-0000-4000-8000-0000000000d1', model: 'Pixel 3a', batteryPct: 57, charging: false, network: 'wifi', simState: 'ready',
  statusAt: minutesAgo(2), alerts: [], ...over
})

type Reply = { status?: number, body?: unknown }
async function home(page: import('@playwright/test').Page, status: () => Reply | Promise<Reply>, child: Record<string, unknown> = kid) {
  return mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [child] }),
    [`GET /api/children/${FY}/journal`]: () => ({ body: { items: [], next: null } }),
    [`GET /api/children/${FY}/status`]: status
  })
}

// Ligne d'état de la carte : la pastille (texte et icône) puis « vu à HH:MM ».
const pill = (page: import('@playwright/test').Page) => page.locator('.child .pill:not(.pending)')
async function expectPill(page: import('@playwright/test').Page, text: string, level: string) {
  await expect(pill(page)).toHaveText(text)
  await expect(pill(page)).toHaveClass(new RegExp(`\\b${level}\\b`))
  await expect(pill(page).locator('svg')).toHaveCount(1)
}

test('tuiles Batterie · Réseau · Carte SIM ; pastille « Tout va bien » et « vu à »', async ({ page }) => {
  await home(page, () => ({ body: { devices: [device()] } }))
  await page.goto('/espace')
  const state = page.getByRole('region', { name: 'État du téléphone de Fy' })
  await expect(state.getByRole('definition').nth(0)).toHaveText('57 %')
  await expect(state.getByRole('term')).toHaveText(['Batterie', 'Réseau', 'Carte SIM'])
  await expect(state.getByRole('definition')).toHaveText(['57 %', 'Wi-Fi', 'Présente'])
  await expectPill(page, 'Tout va bien', 'ok')
  const card = page.getByRole('button', { name: /^Fy / })
  await expect(card).toContainText(/Tout va bien\s*vu à \d\d:\d\d$/)
  // Une seule ligne « vu » par carte : plus de « Vu il y a » sous les tuiles.
  await expect(page.getByText(/^Vu /)).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  // Aucune tuile en défaut : aucune icône dans les tuiles.
  await expect(state.locator('dd svg')).toHaveCount(0)
})

// Chaque alerte : bandeau avec icône et texte court sans prénom, pastille du bon niveau,
// tuile en défaut marquée d'une icône (jamais la couleur seule).
const CASES = [
  { kind: 'battery_low', over: { batteryPct: 12 }, banner: 'Batterie faible', mg: 'Efa ho lany ny bateria', pill: 'À vérifier', level: 'warn', tile: 0 },
  { kind: 'sim_absent', over: { simState: 'absent' }, banner: 'Pas de carte SIM', mg: 'Tsy misy karatra SIM', pill: 'À vérifier', level: 'warn', tile: 2 },
  { kind: 'silent', over: { network: 'none', statusAt: minutesAgo(90) }, banner: 'Le téléphone ne répond plus', mg: 'Tsy mamaly intsony ny finday', pill: 'Ne répond plus', level: 'alert', tile: 1 }
] as const
for (const c of CASES) {
  test(`alerte ${c.kind} : bandeau avec icône, pastille « ${c.pill} », tuile marquée ; malgache`, async ({ page }) => {
    await home(page, () => ({ body: { devices: [device({ ...c.over, alerts: [{ kind: c.kind, openedAt: minutesAgo(5) }] })] } }))
    await page.goto('/espace')
    const banner = page.getByRole('alert')
    await expect(banner).toHaveCount(1)
    await expect(banner.locator('strong')).toHaveText(c.banner)
    await expect(banner).toContainText('Signalé il y a 5 minutes')
    await expect(banner).not.toContainText('Fy')
    await expect(banner.locator('svg')).toHaveCount(1)
    await expectPill(page, c.pill, c.level)
    const state = page.getByRole('region', { name: 'État du téléphone de Fy' })
    await expect(state.locator('.tile').nth(c.tile).locator('dd svg')).toHaveCount(1)
    await expect(state.locator('dd svg')).toHaveCount(1)
    await page.evaluate(() => localStorage.setItem('akaiky-v2.lang', 'mg'))
    await page.reload()
    await expect(page.getByRole('alert').locator('strong')).toHaveText(c.mg)
    await expect(page.getByRole('button', { name: /^Fy / })).toContainText(/hita tamin’ny \d\d:\d\d$/)
  })
}

test('sans téléphone : pastille grise « Téléphone non relié » avec icône, sans heure ni tuiles', async ({ page }) => {
  await home(page, () => ({ body: { devices: [] } }), { ...kid, phoneLastSeenAt: null })
  await page.goto('/espace')
  await expectPill(page, 'Téléphone non relié', 'none')
  await expect(page.getByRole('button', { name: /^Fy / })).not.toContainText('vu à')
  await expect(page.getByRole('region', { name: 'État du téléphone de Fy' })).toHaveCount(0)
})

test('la carte ne bouge pas quand l’état du téléphone arrive', async ({ page }) => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await home(page, async () => { await held; return { body: { devices: [device()] } } })
  await page.goto('/espace')
  const card = page.locator('li.child').first()
  await expect(card.getByRole('heading', { name: /Fy/ })).toBeVisible()
  // Journal du jour affiché (vide) : seule l'arrivée de l'état peut encore changer la carte.
  await expect(card.getByText('Rien aujourd’hui pour l’instant.')).toBeVisible()
  await expect(pill(page)).toHaveCount(0)
  const before = (await card.boundingBox())?.height
  release()
  await expectPill(page, 'Tout va bien', 'ok')
  await expect(page.getByRole('region', { name: 'État du téléphone de Fy' }).getByRole('definition')).toHaveText(['57 %', 'Wi-Fi', 'Présente'])
  const after = (await card.boundingBox())?.height
  expect(before).toBeGreaterThan(0)
  expect(after).toBe(before)
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

// Revue NAR-192 : jamais un « Tout va bien » périmé ni deviné.
test('relecture en échec après « Tout va bien » : la pastille n’affirme plus rien', async ({ page }) => {
  let down = false
  const calls = await home(page, () => down ? { status: 503, body: { error: 'Indisponible.' } } : { body: { devices: [device()] } })
  await page.goto('/espace')
  await expectPill(page, 'Tout va bien', 'ok')
  down = true
  const before = calls.filter((r) => r.url().endsWith('/status')).length
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => calls.filter((r) => r.url().endsWith('/status')).length).toBeGreaterThan(before)
  await expect(pill(page)).toHaveCount(0)
  // Les derniers relevés restent, la carte ne saute pas.
  await expect(page.getByRole('region', { name: 'État du téléphone de Fy' }).getByRole('definition')).toHaveText(['57 %', 'Wi-Fi', 'Présente'])
  down = false
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expectPill(page, 'Tout va bien', 'ok')
})

test('jamais de relevé du téléphone : pas de « Tout va bien »', async ({ page }) => {
  await home(page, () => ({ body: { devices: [device({ statusAt: null })] } }))
  await page.goto('/espace')
  await expect(page.getByText('Pas encore de nouvelles du téléphone')).toBeVisible()
  await expect(pill(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Fy / })).not.toHaveAccessibleName(/Tout va bien/)
})
