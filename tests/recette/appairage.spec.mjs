// Appairage du téléphone de l'enfant (NAR-138). Le scan par un vrai téléphone
// relève de C04 (natif) ; ici, le parent obtient le QR sur le vrai serveur.
import { test, expect, newClient } from './support.mjs'

test('un parent crée sa famille, ajoute un enfant et obtient un QR d’appairage @C03 @C90', async ({ page }) => {
  await newClient(page)
  await page.goto('/espace')
  await page.getByLabel('Nom de la famille').fill('Famille Recette')
  await page.getByRole('button', { name: 'Créer ma famille' }).click()
  await page.getByRole('link', { name: 'Ajouter un enfant' }).click()
  await page.getByLabel('Prénom').fill('Fy')
  await page.getByRole('checkbox', { name: /autorité parentale sur cet enfant/ }).check()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  // Pas encore de téléphone : « Relier le téléphone » sur la carte (NAR-193) ; le menu « ⋯ »
  // ne propose « Téléphone » qu'une fois un téléphone relié (NAR-195).
  await page.getByRole('button', { name: 'Actions pour Fy' }).click()
  await expect(page.getByRole('dialog', { name: 'Actions pour Fy' }).getByRole('link', { name: 'Téléphone' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Fermer' }).click()
  await page.getByRole('button', { name: 'Relier le téléphone' }).click()
  await expect(page.getByRole('heading', { name: 'Configurer le téléphone de Fy' })).toBeVisible()
  await page.getByRole('button', { name: 'Afficher le QR code' }).click()
  await expect(page.getByRole('img', { name: 'QR code de configuration du téléphone' })).toBeVisible()
  await expect(page.getByText('Valable 15 minutes · usage unique')).toBeVisible()
  await expect(page.getByText('Aucun téléphone appairé pour l’instant.')).toBeVisible()
})
