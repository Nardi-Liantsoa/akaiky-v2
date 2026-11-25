import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'
import { openSection } from './settings'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const contacts = { [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }) }
const PUT = `PUT /api/children/${FY.id}/parent-code`

test('le gestionnaire définit le code parent : refus immédiats, puis « défini le … »', async ({ page }) => {
  const calls = await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [PUT]: () => ({ body: { parentCodeSetAt: '2026-11-18T09:00:00Z', remoteUnlockUntil: null, phoneLastSeenAt: null } })
  })
  await openSection(page, 'Code parent')
  await expect(page.getByText('Pas encore défini')).toBeVisible()
  await page.getByRole('button', { name: 'Définir le code' }).click()
  const code = page.getByLabel('Nouveau code (6 chiffres)'), confirm = page.getByLabel('Confirmer le code')
  // Seuls les chiffres passent, six au plus.
  await code.fill('12a3456789')
  await expect(code).toHaveValue('123456')
  await confirm.fill('123456')
  await page.getByRole('button', { name: 'Enregistrer le code' }).click()
  // Erreur sous le champ fautif et focus dessus (NAR-222).
  await expect(page.locator('#parent-code-error')).toHaveText(/trop facile à deviner/)
  await expect(code).toBeFocused()
  await code.fill('482915')
  await confirm.fill('482916')
  await page.getByRole('button', { name: 'Enregistrer le code' }).click()
  await expect(page.locator('#parent-code-confirm-error')).toHaveText('Les deux codes ne sont pas identiques.')
  await expect(confirm).toBeFocused()
  expect(calls.filter((r) => r.method() === 'PUT')).toHaveLength(0)

  await confirm.fill('482915')
  await page.getByRole('button', { name: 'Enregistrer le code' }).click()
  await expect(page.getByText('Défini le 18 novembre.')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Code enregistré' })).toBeVisible()
  await expect(page.getByLabel('Nouveau code (6 chiffres)')).toHaveCount(0)
  expect(calls.find((r) => r.method() === 'PUT')!.postDataJSON()).toEqual({ code: '482915' })
  await expect(page.getByRole('button', { name: 'Changer le code' })).toBeVisible()
})

test('refus du serveur traduit ; un contact voit l’état sans pouvoir changer le code', async ({ page }) => {
  await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [PUT]: () => ({ status: 400, body: { error: '…', code: 'weak_parent_code' } })
  })
  await openSection(page, 'Code parent')
  await page.getByRole('button', { name: 'Définir le code' }).click()
  await page.getByLabel('Nouveau code (6 chiffres)').fill('482915')
  await page.getByLabel('Confirmer le code').fill('482915')
  await page.getByRole('button', { name: 'Enregistrer le code' }).click()
  await expect(page.getByRole('alert')).toHaveText(/trop facile à deviner/)

  const asMember = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: asMember }),
    'GET /api/children': () => ({ body: [{ ...FY, parentCodeSetAt: '2026-11-17T09:00:00Z', remoteUnlockUntil: null, phoneLastSeenAt: null }] })
  })
  await page.reload()
  await expect(page.getByText('Défini le 17 novembre.')).toBeVisible()
  await expect(page.getByRole('button', { name: /le code/ })).toHaveCount(0)
})

test('déverrouiller 15 min à distance : demandé, état affiché ; refusé sans code parent', async ({ page }) => {
  const withCode = { ...FY, parentCodeSetAt: '2026-11-17T09:00:00Z' }
  const until = new Date(Date.now() + 15 * 60_000).toISOString()
  const calls = await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [withCode] }),
    [`POST /api/children/${FY.id}/unlock`]: () => ({ body: { remoteUnlockUntil: until } })
  })
  await openSection(page, 'Code parent')
  await page.getByRole('button', { name: 'Déverrouiller 15 min' }).click()
  await expect(page.getByText(/Déverrouillage demandé jusqu’à \d\d:\d\d\./)).toBeVisible()
  expect(calls.filter((r) => r.method() === 'POST' && r.url().endsWith('/unlock'))).toHaveLength(1)
})

test('sans code parent : pas de bouton de déverrouillage', async ({ page }) => {
  await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] })
  })
  await openSection(page, 'Code parent')
  await expect(page.getByText('Pas encore défini')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Déverrouiller 15 min' })).toHaveCount(0)
})

test('nouveau code demandé par l’équipe : bandeau pour le gestionnaire, effacé par le nouveau code ; un contact ne le voit pas', async ({ page }) => {
  const requested = { ...FY, parentCodeSetAt: '2026-11-17T09:00:00Z', parentCodeResetRequestedAt: '2026-11-20T08:00:00Z' }
  await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [requested] }),
    [PUT]: () => ({ body: { parentCodeSetAt: '2026-11-21T09:00:00Z' } })
  })
  await openSection(page, 'Code parent')
  const banner = page.getByRole('status').filter({ hasText: 'L’équipe Akaiky vous demande de choisir un nouveau code' })
  await expect(banner).toContainText('20 novembre')
  await expect(banner).toContainText('L’ancien reste valable')
  // Le déverrouillage à distance reste proposé pendant la demande.
  await expect(page.getByRole('button', { name: 'Déverrouiller 15 min' })).toBeVisible()
  await page.getByRole('button', { name: 'Changer le code' }).click()
  await page.getByLabel('Nouveau code (6 chiffres)').fill('305718')
  await page.getByLabel('Confirmer le code').fill('305718')
  await page.getByRole('button', { name: 'Enregistrer le code' }).click()
  await expect(page.getByText('Défini le 21 novembre.')).toBeVisible()
  await expect(banner).toHaveCount(0)

  const asMember = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: asMember }),
    'GET /api/children': () => ({ body: [requested] })
  })
  await page.reload()
  await expect(page.getByText('Défini le 17 novembre.')).toBeVisible()
  await expect(page.getByText(/L’équipe Akaiky vous demande/)).toHaveCount(0)
})
