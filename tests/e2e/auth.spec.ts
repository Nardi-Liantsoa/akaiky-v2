import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const anonymous = { 'GET /api/auth/me': () => ({ body: { user: null } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }

test('connexion puis espace, avec l’en-tête anti-CSRF', async ({ page }) => {
  const calls = await mockApi(page, {
    ...anonymous,
    'POST /api/auth/login': () => ({ body: { user: USER } }),
    'GET /api/families/me': () => ({ body: FAMILY })
  })
  await page.goto('/connexion')
  await page.fill('#email', USER.email)
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible()
  const login = calls.find((r) => r.url().endsWith('/api/auth/login'))!
  expect(login.headers()['x-app']).toBe('1')
  expect(login.postDataJSON()).toMatchObject({ email: USER.email, rememberDevice: false })
})

test('mauvais mot de passe : message traduit, sans détail serveur', async ({ page }) => {
  await mockApi(page, { ...anonymous, 'POST /api/auth/login': () => ({ status: 401, body: { error: 'Email ou mot de passe incorrect.' } }) })
  await page.goto('/connexion')
  await page.fill('#email', USER.email)
  await page.fill('#password', 'mauvais mot de passe')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email ou mot de passe incorrect.')
})

test('second facteur demandé puis vérifié', async ({ page }) => {
  await mockApi(page, {
    ...anonymous,
    'POST /api/auth/login': () => ({ body: { mfaRequired: true, enrollmentRequired: false } }),
    'POST /api/auth/mfa/verify': (req) => req.postDataJSON().code === '123456' ? { body: { user: { ...USER, is_admin: true } } } : { status: 401, body: { error: 'Code invalide.' } }
  })
  await page.goto('/connexion')
  await page.fill('#email', USER.email)
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.fill('#code', '000000')
  await page.getByRole('button', { name: 'Vérifier' }).click()
  await expect(page.getByRole('alert')).toHaveText('Code invalide ou déjà utilisé.')
  await page.fill('#code', '123456')
  await page.getByRole('button', { name: 'Vérifier' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  // Administrateur : le back-office s'ouvre depuis « Mon compte » (onglet Famille).
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Famille' }).click()
  await expect(page.getByRole('region', { name: 'Mon compte' }).getByRole('link', { name: 'Administration' })).toBeVisible()
})

test('lien de réinitialisation : jeton retiré de la barre d’adresse et envoyé au serveur', async ({ page }) => {
  const token = 'A'.repeat(43)
  const calls = await mockApi(page, { ...anonymous, 'POST /api/auth/reset-password': () => ({ body: { message: 'ok' } }) })
  await page.goto(`/connexion#reset=${token}`)
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('')
  await page.fill('#password', 'court')
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
  await expect(page.getByRole('alert')).toContainText('12 caractères')
  await page.fill('#password', 'une nouvelle phrase de passe')
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
  await expect(page.getByRole('status')).toContainText('Mot de passe modifié')
  expect(calls.find((r) => r.url().endsWith('/reset-password'))!.postDataJSON()).toEqual({ token, password: 'une nouvelle phrase de passe' })
})

test('redirection après connexion : jamais vers un autre site', async ({ page }) => {
  await mockApi(page, { ...anonymous, 'POST /api/auth/login': () => ({ body: { user: USER } }) })
  await page.goto('/connexion?next=//evil.example')
  await page.fill('#email', USER.email)
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/espace')
})

test('route protégée sans session : connexion avec retour prévu', async ({ page }) => {
  await mockApi(page, anonymous)
  await page.goto('/espace/compte/securite')
  await expect(page).toHaveURL(/\/connexion\?next=(%2F|\/)espace(%2F|\/)compte(%2F|\/)securite$/)
  // Ancienne adresse : même garde, après le renvoi dans la coquille parent.
  await page.goto('/securite')
  await expect(page).toHaveURL(/\/connexion\?next=(%2F|\/)espace(%2F|\/)compte(%2F|\/)securite$/)
})

test('serveur injoignable : message réseau, pas de déconnexion silencieuse', async ({ page }) => {
  await mockApi(page, { ...anonymous })
  await page.route('**/api/auth/login', (route) => route.abort('connectionrefused'))
  await page.goto('/connexion')
  await page.fill('#email', USER.email)
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toContainText('Connexion au serveur impossible')
})

test('démarrage hors ligne : « Réessayer » restaure la session sans nouvelle connexion', async ({ page }) => {
  let online = false
  await mockApi(page, {
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/auth/me': () => ({ body: { user: USER } })
  })
  await page.route('**/api/auth/me', (route) => online ? route.fallback() : route.abort('internetdisconnected'))
  await page.goto('/espace')
  await expect(page).toHaveURL(/\/connexion/)
  await expect(page.getByRole('status')).toContainText('Connexion au serveur impossible')
  online = true
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
})

test('serveur en cours de déploiement (503) : pas de déconnexion, « Réessayer » proposé', async ({ page }) => {
  await mockApi(page, {
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/auth/me': () => ({ status: 503, body: { error: 'Service en cours de démarrage.' } })
  })
  await page.goto('/espace')
  await expect(page.getByRole('status')).toContainText('Le service est occupé')
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible()
})
