import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'
import { openSection } from './settings'

// Applications autorisées (NAR-143) : carte de Réglages, puces et liste du téléphone.
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const base = {
  ...me,
  [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
  'GET /api/children': () => ({ body: [FY] })
}
const APPS = `GET /api/children/${FY.id}/apps`
const PUT = `PUT /api/children/${FY.id}/allowed-apps`
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const INVENTORY = [
  { package: 'com.android.camera2', label: 'Appareil photo', icon: PNG },
  { package: 'com.android.calculator2', label: 'Calculatrice', icon: null },
  { package: 'com.android.deskclock', label: 'Horloge', icon: null },
  { package: 'com.android.gallery3d', label: 'Galerie', icon: null },
  { package: 'com.android.music', label: 'Musique', icon: null }
]

// Serveur simulé avec état : la liste suit les PUT acceptés.
function server(initial: string[] = []) {
  let allowed = initial
  const view = () => ({
    max: 4,
    inventory: INVENTORY.map((a) => ({ ...a, allowed: allowed.includes(a.package) })),
    allowed: allowed.map((p, i) => ({ package: p, label: INVENTORY.find((a) => a.package === p)!.label, position: i + 1 }))
  })
  return {
    [APPS]: () => ({ body: view() }),
    [PUT]: (req: { postDataJSON(): { packages: string[] } }) => { allowed = req.postDataJSON().packages; return { body: { max: 4, allowed: view().allowed } } }
  }
}

test('le gestionnaire ajoute une application depuis la liste du téléphone puis la retire', async ({ page }) => {
  const calls = await mockApi(page, { ...base, 'GET /api/families/me': () => ({ body: FAMILY }), ...server() })
  await openSection(page, 'Applications autorisées')
  const card = page.locator('#applications')
  await expect(card.getByRole('heading', { name: 'Applications autorisées' })).toBeVisible()
  await expect(card.getByText('Aucune application autorisée pour l’instant.')).toBeVisible()
  await card.getByRole('button', { name: '+ Ajouter' }).click()
  const picker = card.getByRole('group', { name: 'Applications du téléphone' })
  await expect(picker.getByRole('button')).toHaveCount(6) // 5 applications + « Fermer »
  await picker.getByRole('button', { name: 'Appareil photo' }).click()
  await expect(card.getByText('✓ Appareil photo')).toBeVisible()
  await expect(card.getByText('1 sur 4')).toBeVisible()
  await expect(picker).toBeHidden()
  await card.getByRole('button', { name: 'Retirer Appareil photo' }).click()
  await expect(card.getByText('Aucune application autorisée pour l’instant.')).toBeVisible()
  expect(calls.filter((r) => r.method() === 'PUT').map((r) => r.postDataJSON())).toEqual([{ packages: ['com.android.camera2'] }, { packages: [] }])
})

test('4 applications au plus : plus de « + Ajouter », message affiché', async ({ page }) => {
  await mockApi(page, { ...base, 'GET /api/families/me': () => ({ body: FAMILY }), ...server(INVENTORY.slice(0, 4).map((a) => a.package)) })
  await openSection(page, 'Applications autorisées')
  const card = page.locator('#applications')
  await expect(card.getByText('4 sur 4')).toBeVisible()
  await expect(card.getByRole('button', { name: '+ Ajouter' })).toHaveCount(0)
  await expect(card.getByText(/4 applications au plus : retirez-en une/)).toBeVisible()
})

test('refus du serveur (application protégée) : message traduit, liste inchangée', async ({ page }) => {
  await mockApi(page, {
    ...base, 'GET /api/families/me': () => ({ body: FAMILY }), ...server(),
    [PUT]: () => ({ status: 400, body: { error: 'Cette application ne peut pas être autorisée.', code: 'protected_app' } })
  })
  await openSection(page, 'Applications autorisées')
  const card = page.locator('#applications')
  await card.getByRole('button', { name: '+ Ajouter' }).click()
  await card.getByRole('button', { name: 'Calculatrice' }).click()
  await expect(card.getByRole('alert')).toHaveText('Cette application ne peut pas être autorisée.')
  await expect(card.getByText('Aucune application autorisée pour l’instant.')).toBeVisible()
})

test('le téléphone n’a encore rien envoyé : le parent le sait', async ({ page }) => {
  await mockApi(page, { ...base, 'GET /api/families/me': () => ({ body: FAMILY }) })
  await openSection(page, 'Applications autorisées')
  const card = page.locator('#applications')
  await expect(card.getByText('Le téléphone n’a pas encore envoyé la liste de ses applications.')).toBeVisible()
  await expect(card.getByRole('button', { name: '+ Ajouter' })).toHaveCount(0)
})

test('un contact voit les applications autorisées sans pouvoir les changer', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  const calls = await mockApi(page, { ...base, 'GET /api/families/me': () => ({ body: asMember }), ...server(['com.android.deskclock']) })
  await openSection(page, 'Applications autorisées')
  const card = page.locator('#applications')
  await expect(card.getByText('✓ Horloge')).toBeVisible()
  await expect(card.getByRole('button')).toHaveCount(0)
  expect(calls.filter((r) => r.method() === 'PUT')).toHaveLength(0)
})

test('autorisée devenue protégée : « bloquée », refus qui la nomme, puis retirée', async ({ page }) => {
  let allowed = [
    { package: 'com.android.deskclock', label: 'Horloge', position: 1 },
    { package: 'com.exemple.lecteur', label: 'Lecteur', position: 2, blocked: true }
  ]
  const calls = await mockApi(page, {
    ...base, 'GET /api/families/me': () => ({ body: FAMILY }),
    [APPS]: () => ({ body: { max: 4, inventory: INVENTORY.map((a) => ({ ...a, allowed: allowed.some((b) => b.package === a.package) })), allowed } }),
    [PUT]: (req: { postDataJSON(): { packages: string[] } }) => {
      const { packages } = req.postDataJSON()
      if (packages.includes('com.exemple.lecteur')) return { status: 400, body: { error: 'x', code: 'protected_app', package: 'com.exemple.lecteur' } }
      allowed = allowed.filter((a) => packages.includes(a.package)).map((a, i) => ({ ...a, position: i + 1 }))
      return { body: { max: 4, allowed } }
    }
  })
  await openSection(page, 'Applications autorisées')
  const card = page.locator('#applications')
  await expect(card.getByText('Lecteur : bloquée')).toBeVisible()
  await expect(card.getByText('✓ Horloge')).toBeVisible()
  await card.getByRole('button', { name: '+ Ajouter' }).click()
  await card.getByRole('button', { name: 'Calculatrice' }).click()
  await expect(card.getByRole('alert')).toHaveText('Lecteur : Cette application ne peut pas être autorisée.')
  await card.getByRole('button', { name: 'Retirer Lecteur' }).click()
  await expect(card.getByText('Lecteur : bloquée')).toHaveCount(0)
  await expect(card.getByText('✓ Horloge')).toBeVisible()
  expect(calls.filter((r) => r.method() === 'PUT').at(-1)?.postDataJSON()).toEqual({ packages: ['com.android.deskclock'] })
})
