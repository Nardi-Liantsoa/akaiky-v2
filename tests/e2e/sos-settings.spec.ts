import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Réglages du SOS (NAR-151) : sirène pendant un SOS, carte de Réglages.
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const contacts = { [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }) }
const PUT = `PUT /api/children/${FY.id}/sos-siren`

test('le gestionnaire allume la sirène : l’interrupteur suit la réponse du serveur', async ({ page }) => {
  const calls = await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [PUT]: (req) => ({ body: { sosSiren: req.postDataJSON().enabled } })
  })
  await page.goto('/espace/reglages')
  const siren = page.getByRole('switch', { name: 'Sirène pendant un SOS' })
  await expect(siren).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText(/sonne très fort pendant 2 minutes au plus/)).toBeVisible()
  await siren.click()
  await expect(siren).toHaveAttribute('aria-checked', 'true')
  expect(calls.filter((r) => r.method() === 'PUT').map((r) => r.postDataJSON())).toEqual([{ enabled: true }])
})

test('refus du serveur : message affiché, interrupteur inchangé', async ({ page }) => {
  await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [PUT]: () => ({ status: 500, body: { error: 'Erreur interne.' } })
  })
  await page.goto('/espace/reglages')
  const siren = page.getByRole('switch', { name: 'Sirène pendant un SOS' })
  await siren.click()
  await expect(page.locator('#sos').getByRole('alert')).toBeVisible()
  await expect(siren).toHaveAttribute('aria-checked', 'false')
  await expect(siren).toBeEnabled()
})

test('un contact voit l’état de la sirène sans pouvoir le changer', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  const calls = await mockApi(page, {
    ...me, ...contacts,
    'GET /api/families/me': () => ({ body: asMember }),
    'GET /api/children': () => ({ body: [{ ...FY, sosSiren: true }] })
  })
  await page.goto('/espace/reglages')
  const siren = page.getByRole('switch', { name: 'Sirène pendant un SOS' })
  await expect(siren).toBeDisabled()
  await expect(siren).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#sos').getByText('Activée')).toBeVisible()
  expect(calls.filter((r) => r.method() === 'PUT')).toHaveLength(0)
})
