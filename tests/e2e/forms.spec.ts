import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Composants de base (NAR-222, audit UI du 25/11/2026) : aucun bouton d'envoi grisé pour une
// saisie incomplète ; à l'envoi, l'erreur s'affiche sous le champ et le focus va au premier
// champ fautif. Couleur proposée d'office, pastilles nommées, cibles ≥ 44 px.
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }

test('ajouter un enfant : bouton actif, erreurs sous le prénom et la case, focus sur le premier champ fautif', async ({ page }) => {
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/children': () => ({ body: [] }) })
  await page.goto('/espace/enfant/nouveau')
  await expect(page.getByRole('heading', { level: 1, name: 'Ajouter un enfant' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Enregistrer' })
  await expect(save).toBeEnabled()
  // Couleur choisie d'office (la moins portée : orange pour un premier enfant), nommée.
  await expect(page.getByRole('radio', { name: 'Orange' })).toBeChecked()
  await save.click()
  await expect(page.getByText('Saisissez un prénom pour continuer.')).toBeVisible()
  await expect(page.getByText('Cochez cette case pour continuer.')).toBeVisible()
  await expect(page.getByLabel('Prénom')).toBeFocused()
  await expect(page.getByLabel('Prénom')).toHaveAttribute('aria-invalid', 'true')
  expect(calls.some((r) => r.method() === 'POST')).toBe(false)
  // L'erreur du prénom s'efface dès la saisie ; la case reste à cocher, et reçoit le focus.
  await page.getByLabel('Prénom').fill('Tiana')
  await expect(page.getByText('Saisissez un prénom pour continuer.')).toHaveCount(0)
  await save.click()
  await expect(page.getByRole('checkbox', { name: /autorité parentale/ })).toBeFocused()
  // Clavier : les flèches changent de couleur (vrais boutons radio).
  await page.getByRole('radio', { name: 'Orange' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Bleu' })).toBeChecked()
})

test('créer sa famille sans nom : message sous le champ, rien n’est envoyé', async ({ page }) => {
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ status: 404, body: { error: 'x', code: 'no_family' } }) })
  await page.goto('/espace')
  const create = page.getByRole('button', { name: 'Créer ma famille' })
  await expect(create).toBeEnabled()
  await create.click()
  await expect(page.getByText('Saisissez le nom de la famille pour continuer.')).toBeVisible()
  await expect(page.getByLabel('Nom de la famille')).toBeFocused()
  expect(calls.some((r) => r.method() === 'POST')).toBe(false)
})

test('cibles : pastilles de couleur, case de consentement et flèche de retour ≥ 44 px à 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/children': () => ({ body: [] }) })
  await page.goto('/espace/enfant/nouveau')
  await expect(page.getByRole('radio', { name: 'Orange' })).toBeVisible()
  const targets = [
    page.getByRole('link', { name: 'Retour à l’accueil' }),
    page.locator('label.swatch').first(),
    page.locator('.consent label')
  ]
  for (const target of targets) {
    const b = (await target.boundingBox())!
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
