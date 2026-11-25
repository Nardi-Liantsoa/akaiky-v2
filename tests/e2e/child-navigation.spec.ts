import { expect, test, type Page, type Request } from '@playwright/test'
import { confirmSheet } from './confirm'
import { FAMILY, mockApi, USER } from './mock'

// NAR-195 : menu « ⋯ » d'une carte (×, fond, Échap ; « Téléphone » seulement avec un
// téléphone relié), « ‹ Accueil » en tête de Modifier et de l'appairage, sans « Annuler »,
// et confirmation avant de quitter Modifier avec des changements non enregistrés.
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const kid = (n: number, firstName: string, phoneLastSeenAt: string | null) => ({
  id: `6f1c2b1e-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, firstName, avatarColor: 'orange', createdAt: '2026-11-11T10:00:00Z',
  parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt, sosSiren: false, phone: null
})
const FY = kid(1, 'Fy', null)
const TIANA = kid(2, 'Tiana', new Date().toISOString())

async function setup(page: Page) {
  let items = [FY, TIANA]
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: items }),
    [`GET /api/children/${TIANA.id}/journal`]: () => ({ body: { items: [], next: null } }),
    [`GET /api/children/${FY.id}/devices`]: () => ({ body: [] }),
    [`PATCH /api/children/${FY.id}`]: (req) => { const c = { ...FY, ...req.postDataJSON() }; items = [c, TIANA]; return { body: c } }
  })
  return calls
}
const menu = (page: Page, name: string) => page.getByRole('dialog', { name: `Actions pour ${name}` })
const more = (page: Page, name: string) => page.getByRole('button', { name: `Actions pour ${name}` })
const isPatch = (r: Request) => r.method() === 'PATCH'

test('menu « ⋯ » : fermé par ×, le fond ou Échap, focus rendu à « ⋯ » ; plus de grand « Fermer »', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await setup(page)
  await page.goto('/espace')
  for (const how of ['icon', 'backdrop', 'escape'] as const) {
    await more(page, 'Fy').click()
    const sheet = menu(page, 'Fy')
    await expect(sheet).toBeVisible()
    // Un seul bouton de fermeture : le ×, icône nommée, ≥ 48 px.
    const close = sheet.getByRole('button', { name: 'Fermer' })
    await expect(close).toHaveCount(1)
    await expect(close).toHaveText('')
    await expect(close.locator('svg')).toHaveCount(1)
    const box = await close.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(48)
    expect(box?.height).toBeGreaterThanOrEqual(48)
    if (how === 'icon') await close.click()
    else if (how === 'backdrop') await page.mouse.click(4, 4)
    else await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(more(page, 'Fy'), `focus rendu (${how})`).toBeFocused()
  }
})

test('menu « ⋯ » : « Téléphone » seulement quand un téléphone est relié', async ({ page }) => {
  await setup(page)
  await page.goto('/espace')
  // Fy, sans téléphone : la carte propose « Relier le téléphone », le menu ne le répète pas.
  await expect(page.getByRole('button', { name: 'Relier le téléphone' })).toBeVisible()
  await more(page, 'Fy').click()
  await expect(menu(page, 'Fy').getByRole('link')).toHaveText(['Modifier'])
  await expect(menu(page, 'Fy').getByRole('button', { name: 'Code parent' })).toBeVisible()
  await page.keyboard.press('Escape')
  // Tiana, téléphone relié : « Téléphone » mène à l'appairage.
  await more(page, 'Tiana').click()
  await expect(menu(page, 'Tiana').getByRole('link')).toHaveText(['Modifier', 'Téléphone'])
  await menu(page, 'Tiana').getByRole('link', { name: 'Téléphone' }).click()
  await expect(page).toHaveURL(new RegExp(`/espace/enfant/${TIANA.id}/telephone$`))
})

test('Modifier : « ‹ Accueil » en tête, ni « Annuler » ni « Configurer le téléphone » ; sans changement, on part sans question', async ({ page }) => {
  await setup(page)
  await page.goto('/espace')
  await more(page, 'Fy').click()
  await menu(page, 'Fy').getByRole('link', { name: 'Modifier' }).click()
  await expect(page.getByRole('heading', { name: 'Modifier Fy' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Annuler' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Annuler' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Configurer le téléphone' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retirer cet enfant' })).toBeVisible()
  const back = page.getByRole('link', { name: 'Retour à l’accueil' })
  // En-tête de page (NAR-222) : flèche seule, nommée, titre de la page au centre.
  await expect(back).toHaveText('')
  await expect(back).toHaveAttribute('href', '/espace')
  // Un changement annulé à la main ne compte pas.
  await page.getByLabel('Prénom').fill('Fyfy')
  await page.getByLabel('Prénom').fill('Fy')
  await back.click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(confirmSheet(page)).toHaveCount(0)
  // Venu de l'accueil : retour de l'historique (Modifier reste en avant), pas de nouvelle entrée.
  expect(await page.evaluate(() => (history.state as { forward?: string }).forward)).toBe(`/espace/enfant/${FY.id}`)
})

test('Modifier avec des changements : « ‹ Accueil », la barre d’onglets et le retour demandent confirmation', async ({ page }) => {
  const calls = await setup(page)
  await page.goto('/espace')
  await more(page, 'Fy').click()
  await menu(page, 'Fy').getByRole('link', { name: 'Modifier' }).click()
  const url = new RegExp(`/espace/enfant/${FY.id}$`)
  await expect(page).toHaveURL(url)
  await page.getByLabel('Prénom').fill('Fyfy')
  const back = page.getByRole('link', { name: 'Retour à l’accueil' })

  // « ‹ Accueil », puis « Annuler » : on reste, la saisie est gardée.
  await back.click()
  const sheet = confirmSheet(page, 'Quitter sans enregistrer ?')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('listitem')).toHaveText(['vos modifications seront perdues.'])
  await sheet.getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(url)
  await expect(page.getByLabel('Prénom')).toHaveValue('Fyfy')

  // Barre d'onglets, puis Échap : on reste.
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Journal' }).click()
  await expect(confirmSheet(page, 'Quitter sans enregistrer ?')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(url)

  // Retour de l'historique (celui du bouton retour d'Android, main.ts), puis le fond : on reste.
  await page.evaluate(() => history.back())
  await expect(confirmSheet(page, 'Quitter sans enregistrer ?')).toBeVisible()
  await page.mouse.click(4, 4)
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page).toHaveURL(url)
  await expect(page.getByLabel('Prénom')).toHaveValue('Fyfy')

  // Confirmé : on quitte, rien n'est enregistré.
  await back.click()
  await confirmSheet(page).getByRole('button', { name: 'Quitter sans enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('button', { name: /^Fy / })).toBeVisible()
  expect(calls.filter(isPatch)).toHaveLength(0)
})

test('Modifier : après un enregistrement réussi, aucune question', async ({ page }) => {
  const calls = await setup(page)
  await page.goto(`/espace/enfant/${FY.id}`)
  await page.getByLabel('Prénom').fill('Fyfy')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Fyfy / })).toBeVisible()
  expect(calls.filter(isPatch)).toHaveLength(1)
})

test('Ajouter : « ‹ Accueil » en tête, pas d’« Annuler »', async ({ page }) => {
  await setup(page)
  await page.goto('/espace/enfant/nouveau')
  await expect(page.getByRole('heading', { name: 'Ajouter un enfant' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Annuler' })).toHaveCount(0)
  // Adresse ouverte directement : l'accueil remplace l'écran.
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click()
  await expect(page).toHaveURL(/\/espace$/)
})

test('Configurer le téléphone : « ‹ Accueil » en tête, plus d’« Annuler » en bas', async ({ page }) => {
  await setup(page)
  await page.goto('/espace')
  await page.getByRole('button', { name: 'Relier le téléphone' }).click()
  await expect(page.getByRole('heading', { name: 'Configurer le téléphone de Fy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Afficher le QR code' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Annuler' })).toHaveCount(0)
  const back = page.getByRole('link', { name: 'Retour à l’accueil' })
  const box = await back.boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(48)
  await back.click()
  await expect(page).toHaveURL(/\/espace$/)
  expect(await page.evaluate(() => (history.state as { forward?: string }).forward)).toBe(`/espace/enfant/${FY.id}/telephone`)
})
