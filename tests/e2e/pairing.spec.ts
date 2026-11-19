import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'orange', createdAt: '2026-11-11T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const PHONE = { id: '6f1c2b1e-0000-4000-8000-0000000000d1', model: 'Pixel 3a', osVersion: '14', appVersion: '1.0', createdAt: '2026-11-18T10:00:00Z', lastSeenAt: '2026-11-18T10:00:00Z' }
const provisioning = {
  'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': 'mg.nosytech.akaiky.enfant/mg.nosytech.akaiky.AkaikyDeviceAdminReceiver',
  'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': { 'akaiky.pairing': 'x'.repeat(43), 'akaiky.api': 'https://akaiky.test' }
}

test('gestionnaire : QR 15 minutes, le téléphone apparaît, le QR disparaît, retrait en deux temps', async ({ page }) => {
  let phones: typeof PHONE[] = []
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/devices`]: () => ({ body: phones }),
    [`POST /api/children/${FY.id}/pairing`]: () => ({ status: 201, body: { expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), provisioning } }),
    [`POST /api/devices/${PHONE.id}/revoke`]: () => { phones = []; return { body: { ok: true } } }
  })
  await page.goto(`/espace/enfant/${FY.id}`)
  await page.getByRole('link', { name: 'Configurer le téléphone' }).click()
  await expect(page.getByRole('heading', { name: 'Configurer le téléphone de Fy' })).toBeVisible()
  await expect(page.getByText('Étape 3 sur 3')).toBeVisible()
  await expect(page.getByText('Aucun téléphone appairé pour l’instant.')).toBeVisible()

  await page.getByRole('button', { name: 'Afficher le QR code' }).click()
  await expect(page.getByRole('img', { name: 'QR code de configuration du téléphone' })).toBeVisible()
  await expect(page.getByText('Valable 15 minutes · usage unique')).toBeVisible()
  await expect(page.getByText(/^Encore 1[45]:\d\d$/)).toBeVisible()

  // Le téléphone s'appaire : au relevé suivant (5 s), il apparaît et le QR utilisé disparaît.
  phones = [PHONE]
  await expect(page.getByText('Téléphone appairé.')).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('img', { name: 'QR code de configuration du téléphone' })).toHaveCount(0)
  await expect(page.getByText('Pixel 3a')).toBeVisible()

  await page.getByRole('button', { name: 'Retirer' }).click()
  await page.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(page.getByText('Aucun téléphone appairé pour l’instant.')).toBeVisible()
  expect(calls.filter((r) => r.method() === 'POST' && r.url().endsWith('/revoke'))).toHaveLength(1)
})

test('QR expiré : retiré, proposition d’un nouveau', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/devices`]: () => ({ body: [] }),
    [`POST /api/children/${FY.id}/pairing`]: () => ({ status: 201, body: { expiresAt: new Date(Date.now() + 2000).toISOString(), provisioning } })
  })
  await page.goto(`/espace/enfant/${FY.id}/telephone`)
  await page.getByRole('button', { name: 'Afficher le QR code' }).click()
  await expect(page.getByRole('img', { name: 'QR code de configuration du téléphone' })).toBeVisible()
  await expect(page.getByText('Ce QR code a expiré.')).toBeVisible({ timeout: 6000 })
  await expect(page.getByRole('img', { name: 'QR code de configuration du téléphone' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nouveau QR code' })).toBeVisible()
})

test('serveur sans APK configuré : message clair', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/devices`]: () => ({ body: [] }),
    [`POST /api/children/${FY.id}/pairing`]: () => ({ status: 503, body: { error: 'x', code: 'pairing_unavailable' } })
  })
  await page.goto(`/espace/enfant/${FY.id}/telephone`)
  await page.getByRole('button', { name: 'Afficher le QR code' }).click()
  await expect(page.getByRole('alert')).toHaveText('La configuration des téléphones n’est pas encore disponible sur ce serveur.')
})

test('un contact (member) est renvoyé à l’accueil', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }),
    'GET /api/children': () => ({ body: [FY] })
  })
  await page.goto(`/espace/enfant/${FY.id}/telephone`)
  await expect(page).toHaveURL(/\/espace$/)
})
