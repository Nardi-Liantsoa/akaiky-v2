// Consentement à l'inscription et export des données de la famille (NAR-178).
import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const anonymous = { 'GET /api/auth/me': () => ({ body: { user: null } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const signedIn = {
  'GET /api/auth/me': () => ({ body: { user: USER } }),
  'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
  'GET /api/auth/security': () => ({ body: { devices: [], mfaEnabled: false, recoveryCodesRemaining: 0 } }),
  'GET /api/auth/app-sessions': () => ({ body: [] })
}
const SIGNUP_CONSENT = /majeur·e et titulaire de l’autorité parentale/

test('inscription : case de consentement exigée, puis envoyée avec le formulaire', async ({ page }) => {
  const calls = await mockApi(page, { ...anonymous, 'POST /api/auth/register': () => ({ status: 202, body: { confirmationRequired: true } }) })
  await page.goto('/connexion?mode=register')
  await page.fill('#name', 'Camille')
  await page.fill('#email', 'camille@exemple.fr')
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('alert')).toHaveText('Cochez cette case pour continuer.')
  await expect(page.getByRole('checkbox', { name: SIGNUP_CONSENT })).toHaveAttribute('aria-invalid', 'true')
  expect(calls.some((r) => r.url().endsWith('/api/auth/register'))).toBe(false)
  // Cible tactile : la ligne entière, 44 px au moins.
  const box = await page.locator('label[for="signup-consent"]').boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('checkbox', { name: SIGNUP_CONSENT }).check()
  // L'erreur disparaît dès que la case est cochée, avant tout nouvel envoi.
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: SIGNUP_CONSENT })).not.toHaveAttribute('aria-invalid')
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmer votre adresse' })).toBeVisible()
  expect(calls.find((r) => r.url().endsWith('/api/auth/register'))!.postDataJSON()).toEqual({ name: 'Camille', email: 'camille@exemple.fr', password: 'une phrase de passe longue', consent: true })
})

test('sécurité : le parent principal télécharge le fichier JSON de la famille', async ({ page }) => {
  const data = { exportedAt: '2026-11-19T10:00:00.000Z', family: { name: 'Famille Rabe' }, members: [], invitations: [], children: [] }
  await mockApi(page, { ...signedIn, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/families/me/export': () => ({ body: data }) })
  await page.goto('/securite')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exporter les données de la famille' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^akaiky-famille-\d{4}-\d{2}-\d{2}\.json$/)
  const path = await file.path()
  const { readFile } = await import('node:fs/promises')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(data)
})

test('sécurité : trop d’exports, message traduit', async ({ page }) => {
  await mockApi(page, { ...signedIn, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/families/me/export': () => ({ status: 429, body: { error: '…' } }) })
  await page.goto('/securite')
  await page.getByRole('button', { name: 'Exporter les données de la famille' }).click()
  await expect(page.getByRole('alert')).toHaveText('Trop d’exports : réessayez dans une heure.')
})

test('sécurité : un contact ne voit pas le bouton, seulement qui peut exporter', async ({ page }) => {
  await mockApi(page, { ...signedIn, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }) })
  await page.goto('/securite')
  await expect(page.getByText('Le parent principal ou un gestionnaire de la famille peut exporter ses données.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Exporter les données de la famille' })).toHaveCount(0)
})
