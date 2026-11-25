import { expect, test } from '@playwright/test'
import { mockApi } from './mock'

// Page d'accueil publique (NAR-225, maquettes 03 et 04) : accroche, deux actions, aperçu du
// téléphone de l'enfant, trois atouts ; langue par la pastille globe ; pas de lien
// « Connexion » sur la page de connexion. NAR225_SHOTS=<dossier> : captures.
const SHOTS = process.env.NAR225_SHOTS
const visitor = { 'GET /api/auth/me': () => ({ status: 401, body: { error: 'x' } }) }

for (const [w, h] of [[360, 800], [1280, 900]] as const) {
  test(`visiteur à ${w} px : accroche, deux actions, aperçu, trois atouts, sans défilement horizontal`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await mockApi(page, visitor)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Votre enfant joint toujours ses parents. Et rien d’autre.' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Aperçu de l’écran du téléphone de l’enfant' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Ce que fait Akaiky' }).getByRole('listitem')).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/accueil-public-${w}.png`, fullPage: true })
  })
}

test('les deux boutons mènent à l’inscription et à la connexion ; « Connexion » absent de la page de connexion', async ({ page }) => {
  await mockApi(page, visitor)
  await page.goto('/')
  await page.getByRole('link', { name: 'Créer un compte gratuit' }).click()
  await expect(page).toHaveURL(/\/connexion\?mode=register$/)
  await page.goto('/')
  await page.getByRole('main').getByRole('link', { name: 'J’ai déjà un compte' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('banner').getByRole('link', { name: 'Connexion' })).toHaveCount(0)
})

test('langue : la pastille globe porte le code, le choix au clavier change la page', async ({ page }) => {
  await mockApi(page, visitor)
  await page.goto('/')
  const lang = page.getByRole('combobox', { name: 'Langue' })
  await expect(page.getByRole('banner')).toContainText('FR')
  await lang.selectOption('mg')
  await expect(page.getByRole('banner')).toContainText('MG')
  await expect(page.getByRole('link', { name: 'Hamorona kaonty maimaim-poana' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('akaiky-v2.lang'))).toBe('mg')
})
