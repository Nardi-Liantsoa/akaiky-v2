// Trois langues (NAR-212, C22) : les pages clés de l'app parent s'affichent en malgache,
// en français et en anglais, sans débordement à 360 px. La langue vient du compte
// (NAR-211) : un compte créé dans une langue ouvre l'app dans cette langue, puisque le
// navigateur de la recette n'en a choisi aucune.
// Écran de l'enfant : app Android seulement (variante « enfant »), hors de ce navigateur ;
// ses textes sont dans les mêmes catalogues, vérifiés par src/i18n/messages.test.ts.
import { test, expect, newClient, api } from './support.mjs'
import { MESSAGES } from '../../src/i18n/messages.ts'

const PAGES = [
  ['/espace', (t) => t.parent.home.heading],
  ['/espace/journal', (t) => t.parent.log.title],
  ['/espace/reglages', (t) => t.parent.settings.title],
  ['/espace/famille', (t) => t.parent.family.title],
  ['/espace/compte/securite', (t) => t.parent.account.title]
]

for (const lang of ['mg', 'fr', 'en']) {
  test(`pages clés en ${lang}, sans débordement à 360 px @C22 @C90`, async ({ page }) => {
    const t = MESSAGES[lang]
    await page.setViewportSize({ width: 360, height: 740 })
    await newClient(page, { lang })
    expect((await api(page, 'POST', '/families', { name: 'Famille Recette' })).ok()).toBe(true)
    expect((await api(page, 'POST', '/children', { firstName: 'Fy', parentalConsent: true })).ok()).toBe(true)

    for (const [path, heading] of PAGES) {
      await page.goto(path)
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      const tabs = page.getByRole('navigation', { name: t.parent.tabsLabel })
      await expect(tabs).toBeVisible()
      for (const key of ['home', 'log', 'settings', 'family']) {
        await expect(tabs.getByRole('link', { name: t.parent[key].title })).toBeVisible()
      }
      await expect(page.getByRole('heading', { level: 1, name: heading(t), exact: true })).toBeVisible()
      // Contenu chargé (listes, cartes) avant de mesurer : plus aucun bloc « Chargement… ».
      await expect(page.getByText(t.status.loading)).toHaveCount(0)
      // Aucun défilement horizontal : les textes malgaches, plus longs, passent à la ligne.
      const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth)
      expect(overflow, `${path} déborde de ${overflow} px en ${lang}`).toBeLessThanOrEqual(0)
    }
  })
}
