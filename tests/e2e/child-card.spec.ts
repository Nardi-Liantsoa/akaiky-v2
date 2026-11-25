import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Carte enfant de l'accueil (NAR-227, maquette 01) : « Appeler » ouvre tel: avec un numéro,
// sinon la saisie du numéro (gestionnaire) ; « Message » ouvre le journal de l'enfant filtré
// sur ses messages. NAR227_SHOTS=<dossier> : capture.
const SHOTS = process.env.NAR227_SHOTS
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString(), sosSiren: false, phone: '+261340000001' }
const TIANA = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Tiana', avatarColor: 'green', phone: null }
const NOE = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000103', firstName: 'Noé', avatarColor: 'blue', phoneLastSeenAt: null, phone: null }
const api = (family = FAMILY) => ({
  ...me,
  'GET /api/families/me': () => ({ body: family }),
  'GET /api/children': () => ({ body: [FY, TIANA, NOE] }),
  [`GET /api/children/${TIANA.id}/journal`]: () => ({ body: { items: [], next: null } }),
  [`GET /api/children/${FY.id}/journal`]: () => ({ body: { items: [], next: null, today: { calls: 0, blocked: 0, messages: 0, unlocks: 0 } } })
})

test.use({ viewport: { width: 360, height: 800 } })

test('Appeler : tel: avec un numéro ; sans numéro, la saisie du numéro ; Message : journal filtré sur les messages', async ({ page }) => {
  await mockApi(page, api())
  await page.goto('/espace')
  await expect(page.getByRole('link', { name: 'Appeler Fy' })).toHaveAttribute('href', 'tel:+261340000001')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/accueil-360.png`, fullPage: true })
  await page.getByRole('link', { name: 'Ajouter le numéro de Tiana pour l’appeler' }).click()
  await expect(page).toHaveURL(new RegExp(`/espace/enfant/${TIANA.id}$`))
  await page.goto('/espace')
  // Téléphone pas encore relié : « Relier le téléphone » seul, ni Appeler ni Message (maquette 01).
  await expect(page.getByRole('link', { name: /Noé/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Relier le téléphone' })).toBeVisible()
  await page.getByRole('link', { name: 'Messages de Fy' }).click()
  await expect(page).toHaveURL(/\/espace\/journal\?kind=messages$/)
  await expect(page.getByRole('status').filter({ hasText: 'Messages' })).toBeVisible()
})

test('contact (member) sans numéro : aucun bouton Appeler sans effet', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  await mockApi(page, api(asMember))
  await page.goto('/espace')
  await expect(page.getByRole('link', { name: 'Appeler Fy' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Tiana pour l’appeler/ })).toHaveCount(0)
})
