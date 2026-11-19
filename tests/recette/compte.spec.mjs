// Critères du compte fournis par le starter app-propre. Parcours par
// l'interface, comme l'utilisateur ; sélecteurs par rôle et texte visible.
import { test, expect, uniqueEmail, PASSWORD, mailFor, linkIn, newClient } from './support.mjs'

test('inscription, confirmation par email, puis espace @C01 @C90', async ({ page }) => {
  const email = uniqueEmail()
  await page.goto('/connexion')
  await page.getByRole('button', { name: 'Pas encore de compte ? S’inscrire' }).click()
  await page.locator('#name').fill('Camille Recette')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('checkbox', { name: /majeur·e et titulaire de l’autorité parentale/ }).check()
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  const mail = await mailFor(email, /Confirmez/)
  await page.goto(linkIn(mail))
  await page.getByRole('button', { name: 'Confirmer mon adresse' }).click()
  await expect(page.getByText('Adresse confirmée. Vous pouvez vous connecter.')).toBeVisible()
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/espace$/)
})

test('mauvais mot de passe refusé, déconnexion @C02 @C90', async ({ page }) => {
  const { email } = await newClient(page)
  await page.context().clearCookies()
  await page.goto('/connexion')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('pas le bon mot de passe du tout')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email ou mot de passe incorrect.')
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  // Pas d'en-tête dans l'espace parent : la déconnexion est dans « Mon compte » (NAR-156).
  await expect(page.getByRole('banner')).toHaveCount(0)
  await page.getByRole('region', { name: 'Mon compte' }).getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/espace')
  await expect(page).toHaveURL(/\/connexion\?next=/)
})
