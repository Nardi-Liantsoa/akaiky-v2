import { expect, test, type Request } from '@playwright/test'
import { cancelEveryWay, confirmSheet } from './confirm'
import { FAMILY, mockApi, USER } from './mock'
import { openSection } from './settings'

// Plages horaires « école » (NAR-148) : carte de Réglages, gestionnaire et contact.
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const base = `/api/children/${FY.id}/schedules`
type S = { id: string, label: string, days: number, startMin: number, endMin: number, enabled: boolean }
const sid = (n: number) => `6f1c2b1e-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`

function schedulesApi(initial: S[] = []) {
  let items = [...initial]
  let next = items.length + 1
  const sent: { method: string, body?: unknown }[] = []
  const handlers: Record<string, (req: Request) => { status?: number, body?: unknown }> = {
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
    [`GET ${base}`]: () => ({ body: items }),
    [`POST ${base}`]: (req) => {
      const b = req.postDataJSON()
      sent.push({ method: 'POST', body: b })
      const s = { id: sid(next++), ...b }
      items = [...items, s]
      return { status: 201, body: s }
    }
  }
  for (let n = 1; n <= 5; n++) {
    handlers[`PUT ${base}/${sid(n)}`] = (req) => {
      const b = req.postDataJSON()
      sent.push({ method: 'PUT', body: b })
      items = items.map((s) => (s.id === sid(n) ? { ...s, ...b } : s))
      return { body: items.find((s) => s.id === sid(n)) }
    }
    handlers[`DELETE ${base}/${sid(n)}`] = () => {
      sent.push({ method: 'DELETE' })
      items = items.filter((s) => s.id !== sid(n))
      return { body: { ok: true } }
    }
  }
  return { handlers, sent }
}

test('le gestionnaire ajoute « École » lun–ven 8:00–16:00, la désactive, puis la retire après confirmation', async ({ page }) => {
  const api = schedulesApi()
  await mockApi(page, api.handlers)
  await openSection(page, 'Plages horaires')
  const card = page.locator('#plages')
  await expect(card.getByText('Aucune plage pour l’instant.')).toBeVisible()
  await card.getByRole('button', { name: '+ Ajouter une plage' }).click()
  await expect(card.getByLabel('Nom')).toHaveValue('École')
  await expect(card.getByRole('button', { name: 'Samedi' })).toHaveAttribute('aria-pressed', 'false')
  await expect(card.getByRole('button', { name: 'Lundi' })).toHaveAttribute('aria-pressed', 'true')
  await card.getByRole('button', { name: 'Enregistrer la plage' }).click()
  await expect(card.getByText('Lun–Ven · 8:00–16:00 · parents + SOS')).toBeVisible()
  expect(api.sent[0]).toEqual({ method: 'POST', body: { label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true } })

  const toggle = card.getByRole('switch', { name: 'Plage « École » active' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // Interrupteur commun (NAR-186) : zone tactile ≥ 48 × 48 px.
  const box = await toggle.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(48)
  expect(box?.width).toBeGreaterThanOrEqual(48)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(api.sent[1]).toEqual({ method: 'PUT', body: { label: 'École', days: 31, startMin: 480, endMin: 960, enabled: false } })

  // Retrait : la feuille d'abord, rien ne part avant « Confirmer le retrait ».
  const deletes = () => api.sent.filter((x) => x.method === 'DELETE')
  await card.getByRole('button', { name: 'Retirer', exact: true }).click()
  const sheet = confirmSheet(page, 'Retirer la plage « École » ?')
  await expect(sheet.getByRole('listitem')).toHaveText(['le téléphone de l’enfant ne l’appliquera plus, dès sa prochaine mise à jour.'])
  expect(deletes()).toHaveLength(0)
  await sheet.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(card.getByText('Aucune plage pour l’instant.')).toBeVisible()
  await expect(confirmSheet(page)).toHaveCount(0)
  expect(deletes()).toHaveLength(1)
})

test('plage de nuit : fin avant le début annoncée ; sans jour ni heures valides, rien ne part', async ({ page }) => {
  const api = schedulesApi()
  await mockApi(page, api.handlers)
  await openSection(page, 'Plages horaires')
  const card = page.locator('#plages')
  await card.getByRole('button', { name: '+ Ajouter une plage' }).click()
  await card.getByLabel('Nom').fill('Nuit')
  await card.getByLabel('Début').fill('21:00')
  await card.getByLabel('Fin').fill('07:00')
  await expect(card.getByText('la plage se termine le lendemain')).toBeVisible()
  for (const d of ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']) await card.getByRole('button', { name: d }).click()
  await card.getByRole('button', { name: 'Enregistrer la plage' }).click()
  await expect(card.getByRole('alert')).toHaveText('Choisissez au moins un jour.')
  await card.getByRole('button', { name: 'Dimanche' }).click()
  await card.getByLabel('Fin').fill('21:00')
  await card.getByRole('button', { name: 'Enregistrer la plage' }).click()
  await expect(card.getByRole('alert')).toHaveText('Début et fin doivent être deux heures différentes.')
  expect(api.sent).toEqual([])
  await card.getByLabel('Fin').fill('07:00')
  await card.getByRole('button', { name: 'Enregistrer la plage' }).click()
  await expect(card.getByText('Dim · 21:00–7:00 · parents + SOS')).toBeVisible()
})

test('retrait d’une plage : Annuler, Échap et fond referment la feuille sans rien envoyer, focus rendu', async ({ page }) => {
  const api = schedulesApi([{ id: sid(1), label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }])
  const calls = await mockApi(page, api.handlers)
  await openSection(page, 'Plages horaires')
  const card = page.locator('#plages')
  await cancelEveryWay(page, card.getByRole('button', { name: 'Retirer', exact: true }), calls, (r) => r.method() === 'DELETE')
  await expect(card.getByText('Lun–Ven · 8:00–16:00 · parents + SOS')).toBeVisible()
  expect(api.sent).toEqual([])
})

test('« Retirer » une plage, dans les trois langues', async ({ page }) => {
  const api = schedulesApi([{ id: sid(1), label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }])
  await mockApi(page, api.handlers)
  for (const [lang, label] of [['fr', 'Retirer'], ['mg', 'Esory'], ['en', 'Remove']] as const) {
    await page.addInitScript((l) => { try { localStorage.setItem('akaiky-v2.lang', l) } catch { /* stockage indisponible */ } }, lang)
    // Page de la section ouverte par son adresse : le titre de sa ligne change avec la langue.
    await page.goto('/espace/reglages/plages')
    await expect(page.locator('#plages').getByRole('button', { name: label, exact: true })).toBeVisible()
  }
})

test('un contact de famille voit les plages sans pouvoir les modifier', async ({ page }) => {
  const api = schedulesApi([{ id: sid(1), label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }])
  await mockApi(page, { ...api.handlers, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }) })
  await openSection(page, 'Plages horaires')
  const card = page.locator('#plages')
  await expect(card.getByText('Lun–Ven · 8:00–16:00 · parents + SOS')).toBeVisible()
  await expect(card.getByText('Active')).toBeVisible()
  await expect(card.getByRole('switch')).toHaveCount(0)
  await expect(card.getByRole('button')).toHaveCount(0)
})

test('aucun contact relié à un parent : la carte prévient que personne ne pourra appeler pendant une plage (NAR-176)', async ({ page }) => {
  const api = schedulesApi([{ id: sid(1), label: 'École', days: 31, startMin: 480, endMin: 960, enabled: true }])
  const mamie = { id: '6f1c2b1e-0000-4000-8000-000000000203', childId: FY.id, name: 'Mamie', phone: '+261321234567', position: 1, avatarColor: 'violet', memberUserId: null, memberRole: null }
  await mockApi(page, { ...api.handlers, [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [mamie] } }) })
  await openSection(page, 'Plages horaires')
  await expect(page.locator('#plages').getByText('Aucun contact n’est relié à un parent')).toBeVisible()
  // Maman reliée au parent principal : plus d'avertissement.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page, { ...api.handlers, [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [{ ...mamie, name: 'Maman', memberUserId: USER.id, memberRole: 'owner' }] } }) })
  await openSection(page, 'Plages horaires')
  await expect(page.locator('#plages').getByText('Lun–Ven · 8:00–16:00 · parents + SOS')).toBeVisible()
  await expect(page.locator('#plages').getByText('Aucun contact n’est relié à un parent')).toHaveCount(0)
})
