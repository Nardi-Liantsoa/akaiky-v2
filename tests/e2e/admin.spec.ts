import { test, expect, type Request } from '@playwright/test'
import { cancelEveryWay, confirmSheet } from './confirm'
import { mockApi, USER, FAMILY } from './mock'

// Back-office de l'équipe (NAR-144) : statistiques, familles et téléphones (tranche 1) ;
// désactivation d'un compte et retrait d'un téléphone, confirmés par la feuille commune (NAR-199).
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

// Comptes : l'administrateur connecté (jamais désactivable par lui-même), un parent par adresse,
// un parent par numéro (le numéro n'est jamais envoyé : « Compte par téléphone »).
const PARENT_ID = 'a1b2c3d4-0000-4000-8000-0000000000a2'
const SMS_ID = 'a1b2c3d4-0000-4000-8000-0000000000a3'
const account = (id: string, email: string | null, extra = {}) => ({
  id, email, name: 'x', is_admin: false, created_at: '2026-01-05T10:00:00Z', email_verified_at: email ? '2026-01-05T10:05:00Z' : null,
  sms_account: !email, verified: true, disabled_at: null as string | null, mfa: false, ...extra
})
const pathOf = (r: Request) => new URL(r.url()).pathname

test('admin : désactiver un compte (feuille de confirmation, annulable), puis le réactiver ; jamais son propre compte', async ({ page }) => {
  const users = [account(ADMIN.id, ADMIN.email, { is_admin: true, mfa: true }), account(PARENT_ID, 'rivo@exemple.fr'), account(SMS_ID, null)]
  const calls = await mockApi(page, adminApi({
    'GET /api/admin/users': () => ({ body: users }),
    [`POST /api/admin/users/${PARENT_ID}/disable`]: () => { users[1].disabled_at = '2026-01-16T08:00:00Z'; return { body: { ok: true } } },
    [`POST /api/admin/users/${PARENT_ID}/enable`]: () => { users[1].disabled_at = null; return { body: { ok: true } } }
  }))
  await page.goto('/admin')
  const section = page.getByRole('region', { name: 'Comptes' })
  const row = (text: string) => section.getByRole('row').filter({ hasText: text })
  await expect(row('rivo@exemple.fr')).toContainText('actif')
  await expect(row('Compte par téléphone')).toBeVisible()
  // Son propre compte : marqué, sans bouton.
  await expect(row(ADMIN.email)).toContainText('(vous)')
  await expect(row(ADMIN.email).getByRole('button')).toHaveCount(0)

  const isWrite = (r: Request) => r.method() === 'POST' && pathOf(r).startsWith('/api/admin/users/')
  const disable = row('rivo@exemple.fr').getByRole('button', { name: 'Désactiver' })
  await cancelEveryWay(page, disable, calls, isWrite)
  await disable.click()
  const sheet = confirmSheet(page, 'Désactiver rivo@exemple.fr ?')
  await expect(sheet.getByRole('listitem')).toHaveCount(3)
  await sheet.getByRole('button', { name: 'Désactiver le compte' }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(row('rivo@exemple.fr')).toContainText('désactivé')
  const writes = calls.filter(isWrite)
  expect(writes.map(pathOf)).toEqual([`/api/admin/users/${PARENT_ID}/disable`])
  expect(writes[0].postData()).toBeNull()
  // Le journal d'audit est relu après l'action.
  expect(calls.filter((c) => pathOf(c) === '/api/admin/audit').length).toBeGreaterThanOrEqual(2)

  // Le focus clavier reste sur le bouton de la ligne (rendu par la feuille, puis après la
  // réactivation) : jamais renvoyé en haut de la page.
  await expect(row('rivo@exemple.fr').getByRole('button', { name: 'Réactiver' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(row('rivo@exemple.fr')).toContainText('actif')
  await expect(row('rivo@exemple.fr').getByRole('button', { name: 'Désactiver' })).toBeFocused()
  expect(calls.filter(isWrite).map(pathOf)).toEqual([`/api/admin/users/${PARENT_ID}/disable`, `/api/admin/users/${PARENT_ID}/enable`])
})

test('admin : refus du serveur (dernier administrateur) affiché dans la feuille, rien de changé', async ({ page }) => {
  const other = account(PARENT_ID, 'autre.admin@exemple.fr', { is_admin: true, mfa: true })
  await mockApi(page, adminApi({
    'GET /api/admin/users': () => ({ body: [account(ADMIN.id, ADMIN.email, { is_admin: true, mfa: true }), other] }),
    [`POST /api/admin/users/${PARENT_ID}/disable`]: () => ({ status: 409, body: { error: 'x', code: 'last_admin' } })
  }))
  await page.goto('/admin')
  const row = page.getByRole('region', { name: 'Comptes' }).getByRole('row').filter({ hasText: 'autre.admin@exemple.fr' })
  await row.getByRole('button', { name: 'Désactiver' }).click()
  const sheet = confirmSheet(page, 'Désactiver autre.admin@exemple.fr ?')
  await sheet.getByRole('button', { name: 'Désactiver le compte' }).click()
  await expect(sheet.getByRole('alert')).toHaveText('Dernier administrateur actif : ce compte ne peut pas être désactivé.')
  await sheet.getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(row).toContainText('actif')
})

test('admin : retirer un téléphone (feuille de confirmation, annulable) ; un téléphone retiré n’a plus de bouton', async ({ page }) => {
  const devices = structuredClone(DEVICES)
  const target = devices.items[0]
  let stats = 0
  const calls = await mockApi(page, adminApi({
    'GET /api/admin/devices': () => ({ body: devices }),
    'GET /api/admin/stats': () => { stats++; return { body: STATS } },
    [`POST /api/admin/devices/${target.id}/revoke`]: () => {
      Object.assign(target, { state: 'revoked', revokedAt: '2026-01-16T08:00:00Z' })
      return { body: { ok: true } }
    }
  }))
  await page.goto('/admin')
  const section = page.getByRole('region', { name: 'Téléphones' })
  const row = section.getByRole('row').filter({ hasText: 'Itel A70' })
  const isWrite = (r: Request) => r.method() === 'POST' && pathOf(r).startsWith('/api/admin/devices/')
  const remove = row.getByRole('button', { name: 'Retirer' })
  await cancelEveryWay(page, remove, calls, isWrite)
  await remove.click()
  const sheet = confirmSheet(page, 'Retirer le téléphone Itel A70 ?')
  await sheet.getByRole('button', { name: 'Retirer le téléphone' }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(row).toContainText('retiré')
  await expect(row.getByRole('button')).toHaveCount(0)
  expect(calls.filter(isWrite).map(pathOf)).toEqual([`/api/admin/devices/${target.id}/revoke`])
  // Statistiques relues après le retrait.
  await expect.poll(() => stats).toBeGreaterThanOrEqual(2)
  // Le nom choisi par la famille n'apparaît toujours nulle part.
  await expect(page.getByText(FAMILY.name)).toHaveCount(0)
})

test('admin : enfants d’une famille par référence, puis demander un nouveau code parent (feuille, annulable)', async ({ page }) => {
  const KID = 'c1c1c1c1-0000-4000-8000-0000000000c1'
  const BARE = 'c2c2c2c2-0000-4000-8000-0000000000c2'
  const kids = [
    { id: KID, createdAt: '2026-01-12T10:00:00Z', codeSet: true, newCodeRequestedAt: null as string | null },
    { id: BARE, createdAt: '2026-01-13T10:00:00Z', codeSet: false, newCodeRequestedAt: null }
  ]
  const calls = await mockApi(page, adminApi({
    [`GET /api/admin/families/${FAM_A}/children`]: () => ({ body: kids }),
    [`POST /api/admin/children/${KID}/parent-code/reset`]: () => {
      kids[0].newCodeRequestedAt = '2026-01-16T08:00:00Z'
      return { body: { ok: true } }
    }
  }))
  await page.goto('/admin')
  const section = page.getByRole('region', { name: 'Familles' })
  // Seul bouton de la ligne de la famille : « Enfants », puis « Masquer » une fois ouverte.
  const show = section.getByRole('row').filter({ hasText: FAM_A.slice(0, 8) }).getByRole('button')
  await expect(show).toHaveText('Enfants')
  await show.click()
  await expect(show).toHaveAttribute('aria-expanded', 'true')
  await expect(show).toHaveText('Masquer')
  const kidsTable = section.locator(`#family-kids-${FAM_A}`).getByRole('table')
  const row = kidsTable.getByRole('row').filter({ hasText: KID.slice(0, 8) })
  await expect(row).toContainText('défini')
  // Sans code défini, rien à remplacer : pas de bouton.
  await expect(kidsTable.getByRole('row').filter({ hasText: BARE.slice(0, 8) })).toContainText('pas défini')
  await expect(kidsTable.getByRole('row').filter({ hasText: BARE.slice(0, 8) }).getByRole('button')).toHaveCount(0)

  const isWrite = (r: Request) => r.method() === 'POST' && pathOf(r).startsWith('/api/admin/children/')
  const ask = row.getByRole('button', { name: 'Demander un nouveau code' })
  await cancelEveryWay(page, ask, calls, isWrite)
  await ask.click()
  const sheet = confirmSheet(page, `Demander un nouveau code parent pour l’enfant ${KID.slice(0, 8)} ?`)
  await expect(sheet).toContainText('vérification d’identité')
  await expect(sheet).toContainText('l’ancien code reste valable')
  await sheet.getByRole('button', { name: 'Demander un nouveau code' }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(row).toContainText('demandé le')
  await expect(row.getByRole('button')).toHaveCount(0)
  expect(calls.filter(isWrite).map(pathOf)).toEqual([`/api/admin/children/${KID}/parent-code/reset`])
  expect(calls.find(isWrite)!.postData()).toBeNull()

  await show.click()
  await expect(kidsTable).toHaveCount(0)
})

test('admin : demande refusée (aucun gestionnaire à adresse) : la feuille se ferme, le refus reste affiché', async ({ page }) => {
  const KID = 'c3c3c3c3-0000-4000-8000-0000000000c3'
  await mockApi(page, adminApi({
    [`GET /api/admin/families/${FAM_A}/children`]: () => ({ body: [{ id: KID, createdAt: '2026-01-12T10:00:00Z', codeSet: true, newCodeRequestedAt: null }] }),
    [`POST /api/admin/children/${KID}/parent-code/reset`]: () => ({ status: 409, body: { error: '…', code: 'no_written_channel' } })
  }))
  await page.goto('/admin')
  const section = page.getByRole('region', { name: 'Familles' })
  await section.getByRole('row').filter({ hasText: FAM_A.slice(0, 8) }).getByRole('button').click()
  await section.getByRole('button', { name: 'Demander un nouveau code' }).click()
  await confirmSheet(page).getByRole('button', { name: 'Demander un nouveau code' }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(section.getByRole('alert')).toHaveText('Aucun gestionnaire de cette famille n’a d’adresse email confirmée : la demande écrite ne peut pas être vérifiée.')
  // La feuille suivante s'ouvre sans ce refus.
  await section.getByRole('button', { name: 'Demander un nouveau code' }).click()
  await expect(confirmSheet(page)).toBeVisible()
  await expect(confirmSheet(page).getByRole('alert')).toHaveCount(0)
})

test('admin à 360 px : tuiles et une carte par ligne, aucun défilement horizontal, actions pleine largeur', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await mockApi(page, adminApi())
  await page.goto('/admin')
  const devices = page.getByRole('region', { name: 'Téléphones' })
  await expect(devices.getByText('Itel A70')).toBeVisible()
  // Paires libellé / valeur (maquette 06) : le libellé de colonne est écrit dans la carte.
  const itel = devices.locator('tr', { hasText: 'Itel A70' })
  expect(await itel.locator('td[data-label]').first().evaluate((td) => getComputedStyle(td, '::before').content)).not.toBe('none')
  const revoke = itel.getByRole('button', { name: 'Retirer' })
  const card = (await itel.boundingBox())!
  const button = (await revoke.boundingBox())!
  expect(button.width).toBeGreaterThan(card.width * 0.8)
  expect(button.height).toBeGreaterThanOrEqual(44)
  // Trois tuiles de statistiques par ligne.
  const tiles = page.getByRole('region', { name: 'Statistiques' }).locator('.tiles > div')
  const tops = await tiles.evaluateAll((els) => els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('admin en malgache à 320 px : aucun libellé ne déborde de sa tuile ni de la page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.addInitScript(() => localStorage.setItem('akaiky-v2.lang', 'mg'))
  await mockApi(page, adminApi())
  await page.goto('/admin')
  const tiles = page.locator('.tiles > div')
  await expect(tiles.first()).toBeVisible()
  const overflowing = await tiles.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length)
  expect(overflowing).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('journal d’audit long : il défile dans sa carte, la page ne s’allonge pas', async ({ page }) => {
  const entries = Array.from({ length: 80 }, (_, i) => ({ at: `2026-01-15T${String(i % 24).padStart(2, '0')}:00:00Z`, action: 'device_revoked', actor: 'admin' }))
  await mockApi(page, adminApi({ 'GET /api/admin/audit': () => ({ body: entries }) }))
  await page.goto('/admin')
  const scroller = page.getByRole('region', { name: 'Journal d’audit' }).locator('.bounded')
  await expect(scroller.getByRole('row')).toHaveCount(81)
  const { client, scroll } = await scroller.evaluate((e) => ({ client: e.clientHeight, scroll: e.scrollHeight }))
  expect(client).toBeLessThanOrEqual(480)
  expect(scroll).toBeGreaterThan(client)
  // Atteignable au clavier pour défiler aux flèches.
  await expect(scroller).toHaveAttribute('tabindex', '0')
})

test('beaucoup de comptes : la liste défile dans sa carte', async ({ page }) => {
  const users = Array.from({ length: 60 }, (_, i) => ({ id: `6f1c2b1e-0000-4000-8000-0000000003${String(i).padStart(2, '0')}`, email: `compte${i}@exemple.fr`, created_at: '2026-01-10T10:00:00Z', verified: true, mfa: false, is_admin: false, disabled_at: null }))
  await mockApi(page, adminApi({ 'GET /api/admin/users': () => ({ body: users }) }))
  await page.goto('/admin')
  const scroller = page.getByRole('region', { name: 'Comptes' }).locator('.bounded')
  await expect(scroller.getByRole('row')).toHaveCount(61)
  const { client, scroll } = await scroller.evaluate((e) => ({ client: e.clientHeight, scroll: e.scrollHeight }))
  expect(client).toBeLessThanOrEqual(480)
  expect(scroll).toBeGreaterThan(client)
  await expect(scroller).toHaveAttribute('tabindex', '0')
})
