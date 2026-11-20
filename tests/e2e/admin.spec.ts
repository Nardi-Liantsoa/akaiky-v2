import { test, expect } from '@playwright/test'
import { mockApi, USER, FAMILY } from './mock'

// Back-office de l'équipe (NAR-144, tranche 1) : statistiques, familles et téléphones en lecture seule.
const ADMIN = { ...USER, is_admin: true }
const FAM_A = 'aa01aa01-0000-4000-8000-000000000001'
const FAM_B = 'bb02bb02-0000-4000-8000-000000000002'
const STATS = { families: 2, children: 3, devices: 2, activeDevices: 1, silentDevices: 1, devicesSignal24h: 1, sosThisMonth: 0, sosTracked: false }
const DEVICES = {
  items: [
    { id: '6f1c2b1e-0000-4000-8000-0000000000d1', familyId: FAM_A, model: 'Itel A70', osVersion: '13', appVersion: '1.4.2', createdAt: '2026-01-12T10:00:00Z', lastSeenAt: '2026-01-15T09:00:00Z', statusAt: '2026-01-15T09:00:00Z', revokedAt: null, state: 'active' },
    { id: '6f1c2b1e-0000-4000-8000-0000000000d2', familyId: FAM_B, model: null, osVersion: '11', appVersion: '1.4.0', createdAt: '2026-01-10T10:00:00Z', lastSeenAt: '2026-01-14T09:00:00Z', statusAt: null, revokedAt: null, state: 'silent' }
  ],
  next: null
}
const famPage = (id: string, next: string | null) => ({ items: [{ id, members: 2, children: 1, devices: 1, createdAt: '2026-01-12T10:00:00Z' }], next })

function adminApi(overrides: Parameters<typeof mockApi>[1] = {}) {
  return {
    'GET /api/auth/me': () => ({ body: { user: ADMIN } }),
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/admin/users': () => ({ body: [] }),
    'GET /api/admin/audit': () => ({ body: [] }),
    'GET /api/admin/stats': () => ({ body: STATS }),
    'GET /api/admin/devices': () => ({ body: DEVICES }),
    'GET /api/admin/families': (req: { url: () => string }) => new URL(req.url()).searchParams.get('before')
      ? { body: famPage(FAM_B, null) }
      : { body: famPage(FAM_A, `2026-01-12T10:00:00.000000Z_${FAM_A}`) },
    ...overrides
  }
}

test('admin : statistiques, familles par référence (page suivante par curseur), téléphones et leur état', async ({ page }) => {
  const calls = await mockApi(page, adminApi())
  await page.goto('/admin')
  const stats = page.getByRole('region', { name: 'Statistiques' })
  await expect(stats.getByText('Téléphones appairés')).toBeVisible()
  await expect(stats.getByText('pas encore suivi')).toBeVisible()

  const families = page.getByRole('region', { name: 'Familles' })
  await expect(families.getByRole('cell', { name: FAM_A.slice(0, 8) })).toBeVisible()
  // Le nom choisi par la famille n'est jamais affiché (et l'API ne l'envoie pas).
  await expect(page.getByText(FAMILY.name)).toHaveCount(0)
  await families.getByRole('button', { name: 'Afficher plus' }).click()
  await expect(families.getByRole('cell', { name: FAM_B.slice(0, 8) })).toBeVisible()
  await expect(families.getByRole('cell', { name: FAM_A.slice(0, 8) })).toBeVisible()
  await expect(families.getByRole('button', { name: 'Afficher plus' })).toHaveCount(0)
  const famCalls = calls.filter((c) => new URL(c.url()).pathname === '/api/admin/families').map((c) => new URL(c.url()).searchParams)
  expect(famCalls.map((p) => p.get('limit'))).toEqual(['50', '50'])
  expect(famCalls[1].get('before')).toBe(`2026-01-12T10:00:00.000000Z_${FAM_A}`)

  const devices = page.getByRole('region', { name: 'Téléphones' })
  const rows = devices.getByRole('row')
  await expect(rows.filter({ hasText: 'Itel A70' })).toContainText('actif')
  await expect(rows.filter({ hasText: 'Modèle inconnu' })).toContainText('silencieux')
  await expect(rows.filter({ hasText: 'Modèle inconnu' })).toContainText('jamais')
})

test('admin : liste en erreur, puis « Réessayer » la recharge ; liste vide annoncée', async ({ page }) => {
  let fail = true
  await mockApi(page, adminApi({
    'GET /api/admin/devices': () => fail ? { status: 500, body: { error: 'Erreur interne.' } } : { body: DEVICES },
    'GET /api/admin/families': () => ({ body: { items: [], next: null } })
  }))
  await page.goto('/admin')
  await expect(page.getByRole('region', { name: 'Familles' }).getByText('Aucune famille.')).toBeVisible()
  const devices = page.getByRole('region', { name: 'Téléphones' })
  await expect(devices.getByRole('alert')).toBeVisible()
  fail = false
  await devices.getByRole('button', { name: 'Réessayer' }).click()
  await expect(devices.getByRole('cell', { name: 'Itel A70' })).toBeVisible()
})

test('parent non administrateur : /admin renvoie à son espace, aucune route admin appelée', async ({ page }) => {
  const calls = await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'GET /api/families/me': () => ({ body: FAMILY })
  })
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/espace$/)
  expect(calls.some((c) => new URL(c.url()).pathname.startsWith('/api/admin/'))).toBe(false)
})
