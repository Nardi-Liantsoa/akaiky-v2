import { expect, test, type Page } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Inscription, confirmation, connexion et réinitialisation par numéro de téléphone (NAR-202),
// sur l'API simulée : contrat de tranche 1 (NAR-136) et 2 (NAR-201).
const anonymous = { 'GET /api/auth/me': () => ({ body: { user: null } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const PHONE_USER = { ...USER, email: null, phone: '+261341234567' }
const PASSWORD = 'une phrase de passe longue'

async function choosePhone(page: Page) {
  await page.getByRole('group', { name: 'Identifiant' }).getByRole('button', { name: 'Téléphone' }).click()
}

test('inscription par téléphone : code SMS, confirmation, puis connexion par numéro', async ({ page }) => {
  const calls = await mockApi(page, {
    ...anonymous,
    'POST /api/auth/phone/register': () => ({ status: 202, body: { codeRequired: true, message: 'Un code de confirmation vous a été envoyé par SMS.' } }),
    'POST /api/auth/phone/resend': () => ({ status: 202, body: { message: 'ok' } }),
    'POST /api/auth/phone/confirm': (req) => req.postDataJSON().code === '482913'
      ? { body: { message: 'Numéro confirmé.', phone: PHONE_USER.phone } }
      : { status: 400, body: { error: 'Code invalide ou expiré. Demandez-en un nouveau.', code: 'invalid_code' } },
    'POST /api/auth/login': () => ({ body: { user: PHONE_USER } }),
    'GET /api/families/me': () => ({ body: FAMILY })
  })
  await page.goto('/connexion')
  await page.getByRole('button', { name: 'Pas encore de compte ? S’inscrire' }).click()
  await choosePhone(page)
  await expect(page.getByRole('button', { name: 'Téléphone' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#email')).toHaveCount(0)
  await expect(page.locator('#phone')).toHaveAttribute('autocomplete', 'tel')
  await expect(page.locator('#phone')).toHaveAttribute('type', 'tel')
  await page.fill('#name', 'Fy')
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('checkbox', { name: /majeur·e et titulaire de l’autorité parentale/ }).check()
  await page.getByRole('button', { name: 'Créer le compte' }).click()

  await expect(page.getByRole('heading', { name: 'Confirmer votre numéro' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('un code vient de lui être envoyé par SMS')
  expect(calls.find((r) => r.url().endsWith('/api/auth/phone/register'))!.postDataJSON())
    .toEqual({ phone: '034 12 345 67', name: 'Fy', password: PASSWORD, consent: true, lang: 'fr' })
  await expect(page.locator('#sms-code')).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(page.locator('#sms-code')).toHaveAttribute('inputmode', 'numeric')

  // Mauvais code : message traduit, jamais le texte brut du serveur.
  await page.fill('#sms-code', '000000')
  await page.getByRole('button', { name: 'Confirmer mon numéro' }).click()
  await expect(page.getByRole('alert')).toHaveText('Code invalide ou expiré. Demandez-en un nouveau.')

  await page.getByRole('button', { name: 'Renvoyer le code' }).click()
  await expect.poll(() => calls.filter((r) => r.url().endsWith('/api/auth/phone/resend')).length).toBe(1)
  expect(calls.find((r) => r.url().endsWith('/api/auth/phone/resend'))!.postDataJSON()).toEqual({ phone: '034 12 345 67', lang: 'fr' })
  // Renvoi terminé (il vide le champ du code) avant la saisie du nouveau code.
  await expect(page.getByRole('button', { name: 'Renvoyer le code' })).toBeEnabled()

  await page.fill('#sms-code', '482913')
  await page.getByRole('button', { name: 'Confirmer mon numéro' }).click()
  await expect(page.getByRole('status')).toHaveText('Numéro confirmé. Vous pouvez vous connecter.')
  // Connexion par le numéro normalisé renvoyé par le serveur, déjà rempli.
  await expect(page.locator('#phone')).toHaveValue(PHONE_USER.phone)
  await page.fill('#password', PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  const login = calls.find((r) => r.url().endsWith('/api/auth/login'))!
  // Numéro seul : jamais une adresse dans le même corps (le serveur refuserait les deux).
  expect(login.postDataJSON()).toEqual({ phone: PHONE_USER.phone, password: PASSWORD, rememberDevice: false })
})

test('code SMS en attente : le rechargement ramène à la saisie du code', async ({ page }) => {
  await mockApi(page, { ...anonymous, 'POST /api/auth/phone/register': () => ({ status: 202, body: { codeRequired: true } }) })
  // Inscription ouverte par le bouton (sans ?mode=register à l'arrivée) : l'écran l'écrit dans l'adresse.
  await page.goto('/connexion')
  await page.getByRole('button', { name: 'Pas encore de compte ? S’inscrire' }).click()
  await choosePhone(page)
  await page.fill('#name', 'Fy')
  await page.fill('#phone', '0341234567')
  await page.fill('#password', PASSWORD)
  await page.getByRole('checkbox', { name: /majeur·e/ }).check()
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmer votre numéro' })).toBeVisible()
  await expect(page).toHaveURL(/\/connexion\?mode=register$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Confirmer votre numéro' })).toBeVisible()
  // Retour à la connexion : l'adresse redevient /connexion, l'écran du code n'est plus imposé.
  await page.getByRole('button', { name: 'Déjà un compte ? Se connecter' }).click()
  await expect(page).toHaveURL(/\/connexion$/)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  // Attente abandonnée : une nouvelle inscription n'est plus détournée vers l'ancien code.
  await page.getByRole('button', { name: 'Pas encore de compte ? S’inscrire' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible()
})

test('code collé avec une espace : chiffres seuls envoyés', async ({ page }) => {
  const calls = await mockApi(page, {
    ...anonymous,
    'POST /api/auth/phone/register': () => ({ status: 202, body: { codeRequired: true } }),
    'POST /api/auth/phone/confirm': () => ({ body: { phone: PHONE_USER.phone } })
  })
  await page.goto('/connexion?mode=register')
  await choosePhone(page)
  await page.fill('#name', 'Fy')
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('checkbox', { name: /majeur·e/ }).check()
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await page.fill('#sms-code', '482 913')
  await page.getByRole('button', { name: 'Confirmer mon numéro' }).click()
  await expect(page.getByRole('status')).toHaveText('Numéro confirmé. Vous pouvez vous connecter.')
  expect(calls.find((r) => r.url().endsWith('/api/auth/phone/confirm'))!.postDataJSON()).toEqual({ phone: '034 12 345 67', code: '482913' })
})

test('numéro non confirmé, renvoi refusé (60 s) : la saisie du code s’ouvre quand même', async ({ page }) => {
  await mockApi(page, {
    ...anonymous,
    'POST /api/auth/login': () => ({ status: 403, body: { error: 'x', code: 'phone_unverified' } }),
    'POST /api/auth/phone/resend': () => ({ status: 429, body: { error: 'x', code: 'sms_rate_limited' } })
  })
  await page.goto('/connexion')
  await choosePhone(page)
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.getByRole('button', { name: 'Recevoir un code de confirmation' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmer votre numéro' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('Trop de SMS demandés. Réessayez plus tard.')
  await expect(page.locator('#sms-code')).toBeVisible()
  // Retenue : un rechargement (WebView rechargée pendant la lecture du SMS) y revient.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Confirmer votre numéro' })).toBeVisible()
})

test('numéro non confirmé à la connexion : message clair, nouveau code envoyé, puis saisie', async ({ page }) => {
  const calls = await mockApi(page, {
    ...anonymous,
    'POST /api/auth/login': () => ({ status: 403, body: { error: 'Confirmez votre numéro avant de vous connecter.', code: 'phone_unverified' } }),
    'POST /api/auth/phone/resend': () => ({ status: 202, body: { message: 'ok' } })
  })
  await page.goto('/connexion')
  await choosePhone(page)
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('Confirmez votre numéro avant de vous connecter : demandez un code par SMS.')
  await page.getByRole('button', { name: 'Recevoir un code de confirmation' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmer votre numéro' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('un code vient de lui être envoyé par SMS')
  expect(calls.find((r) => r.url().endsWith('/api/auth/phone/resend'))!.postDataJSON()).toEqual({ phone: '034 12 345 67', lang: 'fr' })
  // Le mot de passe refusé à la connexion n'est repris par aucun autre écran.
  await page.getByRole('button', { name: 'Déjà un compte ? Se connecter' }).click()
  await expect(page.locator('#password')).toHaveValue('')
})

test('mauvais mot de passe par numéro : « Numéro ou mot de passe incorrect. »', async ({ page }) => {
  await mockApi(page, { ...anonymous, 'POST /api/auth/login': () => ({ status: 401, body: { error: 'Numéro ou mot de passe incorrect.' } }) })
  await page.goto('/connexion')
  await choosePhone(page)
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', 'pas le bon mot de passe')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('Numéro ou mot de passe incorrect.')
})

test('SMS indisponibles (503) et trop de SMS (429) : messages clairs', async ({ page }) => {
  await mockApi(page, {
    ...anonymous,
    'POST /api/auth/phone/register': () => ({ status: 503, body: { error: 'Les SMS sont indisponibles pour le moment.', code: 'sms_unavailable' } }),
    'POST /api/auth/phone/forgot': () => ({ status: 429, body: { error: 'Trop de SMS pour ce numéro.', code: 'sms_rate_limited' } }),
    'POST /api/auth/login': () => ({ status: 429, body: { error: 'Too Many Requests' } })
  })
  await page.goto('/connexion?mode=register')
  await choosePhone(page)
  await page.fill('#name', 'Fy')
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('checkbox', { name: /majeur·e/ }).check()
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('alert')).toHaveText('Les SMS sont indisponibles pour le moment. Utilisez une adresse email.')

  await page.getByRole('button', { name: 'Déjà un compte ? Se connecter' }).click()
  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click()
  await expect(page.locator('#phone')).toBeVisible()
  await page.fill('#phone', '034 12 345 67')
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await expect(page.getByRole('alert')).toHaveText('Trop de SMS demandés. Réessayez plus tard.')

  await page.getByRole('button', { name: 'Déjà un compte ? Se connecter' }).click()
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page.getByRole('alert')).toHaveText('Trop de tentatives. Patientez un moment puis réessayez.')
})

test('réinitialisation par code SMS, puis retour à la connexion', async ({ page }) => {
  const calls = await mockApi(page, {
    ...anonymous,
    'POST /api/auth/phone/forgot': () => ({ status: 202, body: { message: 'ok' } }),
    'POST /api/auth/phone/reset': () => ({ body: { message: 'ok' } })
  })
  await page.goto('/connexion')
  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click()
  await choosePhone(page)
  await page.fill('#phone', '034 12 345 67')
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('correspond à un compte')
  expect(calls.find((r) => r.url().endsWith('/api/auth/phone/forgot'))!.postDataJSON()).toEqual({ phone: '034 12 345 67', lang: 'fr' })
  await expect(page.locator('#sms-code')).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(page.locator('#password')).toHaveValue('')
  await page.fill('#sms-code', '123456')
  await page.fill('#password', 'mon numero 0341234567 secret')
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
  await expect(page.getByRole('alert')).toHaveText('Le mot de passe ne doit pas contenir votre numéro de téléphone.')
  await page.fill('#password', 'court')
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
  await expect(page.getByRole('alert')).toContainText('12 caractères')
  await page.fill('#password', 'une nouvelle phrase de passe')
  await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click()
  await expect(page.getByRole('status')).toContainText('Mot de passe modifié')
  expect(calls.find((r) => r.url().endsWith('/api/auth/phone/reset'))!.postDataJSON())
    .toEqual({ phone: '034 12 345 67', code: '123456', password: 'une nouvelle phrase de passe', lang: 'fr' })
  await expect(page.locator('#phone')).toHaveValue('034 12 345 67')
})

test('le choix « Téléphone » est retenu sur l’appareil', async ({ page }) => {
  await mockApi(page, anonymous)
  await page.goto('/connexion')
  await expect(page.locator('#email')).toBeVisible()
  await choosePhone(page)
  await page.reload()
  await expect(page.locator('#phone')).toBeVisible()
  await page.getByRole('button', { name: 'Email' }).click()
  await page.reload()
  await expect(page.locator('#email')).toBeVisible()
})

test('numéro non confirmé, SMS indisponibles : on reste sur la connexion, sans écran de code', async ({ page }) => {
  await mockApi(page, {
    ...anonymous,
    'POST /api/auth/login': () => ({ status: 403, body: { error: 'x', code: 'phone_unverified' } }),
    'POST /api/auth/phone/resend': () => ({ status: 503, body: { error: 'x', code: 'sms_unavailable' } })
  })
  await page.goto('/connexion')
  await choosePhone(page)
  await page.fill('#phone', '034 12 345 67')
  await page.fill('#password', PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.getByRole('button', { name: 'Recevoir un code de confirmation' }).click()
  await expect(page.getByRole('alert')).toHaveText('Les SMS sont indisponibles pour le moment. Utilisez une adresse email.')
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await expect(page.locator('#sms-code')).toHaveCount(0)
})

test('mot de passe oublié, renvoi refusé (60 s) : la saisie du code s’ouvre avec le refus', async ({ page }) => {
  await mockApi(page, { ...anonymous, 'POST /api/auth/phone/forgot': () => ({ status: 429, body: { error: 'x', code: 'sms_rate_limited' } }) })
  await page.goto('/connexion')
  await page.getByRole('button', { name: 'Mot de passe oublié ?' }).click()
  await choosePhone(page)
  await page.fill('#phone', '034 12 345 67')
  await page.getByRole('button', { name: 'Recevoir le code' }).click()
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('Trop de SMS demandés. Réessayez plus tard.')
  await expect(page.locator('#sms-code')).toBeVisible()
})

test('inscription par email en attente : un lien expiré ne l’efface pas', async ({ page }) => {
  await mockApi(page, {
    ...anonymous,
    'POST /api/auth/register': () => ({ status: 202, body: {} }),
    'POST /api/auth/confirm': () => ({ status: 400, body: { error: 'Lien invalide ou expiré.' } })
  })
  await page.goto('/connexion?mode=register')
  await page.fill('#name', 'Fy')
  await page.fill('#email', 'fy@exemple.fr')
  await page.fill('#password', PASSWORD)
  await page.getByRole('checkbox', { name: /majeur·e/ }).check()
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('button', { name: 'Renvoyer l’email de confirmation' })).toBeVisible()
  await page.goto('/connexion?mode=register#confirm=' + 'A'.repeat(43))
  await page.getByRole('button', { name: 'Confirmer mon adresse' }).click()
  await expect(page.getByRole('alert')).toHaveText('Ce lien n’est plus valable. Demandez-en un nouveau.')
  await page.goto('/connexion?mode=register')
  await expect(page.getByRole('button', { name: 'Renvoyer l’email de confirmation' })).toBeVisible()
})
