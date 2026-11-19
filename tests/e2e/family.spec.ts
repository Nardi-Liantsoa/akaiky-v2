import { expect, test } from '@playwright/test'
import { cancelEveryWay, confirmSheet } from './confirm'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }) }
const noFamily = () => ({ status: 404, body: { error: 'Famille introuvable.', code: 'no_family' } })

test('sans famille : création depuis l’accueil, puis onglets et famille affichée', async ({ page }) => {
  let created: typeof FAMILY | null = null
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => created ? { body: created } : noFamily(),
    'POST /api/families': (req) => {
      created = { ...FAMILY, name: req.postDataJSON().name }
      return { status: 201, body: { id: created.id, name: created.name, role: 'owner' } }
    }
  })
  // Un autre onglet renvoie vers l'accueil, qui présente la création.
  await page.goto('/espace/famille')
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0)

  await page.getByLabel('Nom de la famille').fill('  Famille Rakoto ')
  await page.getByRole('button', { name: 'Créer ma famille' }).click()
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible()
  const post = calls.find((r) => r.method() === 'POST' && r.url().endsWith('/api/families'))!
  expect(post.postDataJSON()).toEqual({ name: 'Famille Rakoto' })
  expect(post.headers()['x-app']).toBe('1')

  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Famille' }).click()
  await expect(page.getByRole('heading', { name: 'Famille Rakoto' })).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('listitem')).toContainText('Alice (vous)Parent principal')
})

test('gestionnaire : renommer la famille', async ({ page }) => {
  let name = FAMILY.name
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, name } }),
    'PATCH /api/families/me': (req) => { name = req.postDataJSON().name; return { body: { id: FAMILY.id, name, role: 'owner' } } }
  })
  await page.goto('/espace/famille')
  await page.getByRole('button', { name: 'Renommer' }).click()
  await page.getByLabel('Nom de la famille').fill('Famille Andria')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'Famille Andria' })).toBeVisible()
})

test('contact : pas de bouton pour renommer', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ ...FAMILY.members[0], isMe: false }, { userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: asMember }) })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Famille Rabe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Renommer' })).toHaveCount(0)
  await expect(page.getByRole('listitem').nth(1)).toContainText('Alice (vous)Contact')
})

test('serveur injoignable : erreur et « Réessayer », jamais l’écran de création', async ({ page }) => {
  let down = true
  await mockApi(page, { ...me, 'GET /api/families/me': () => down ? { status: 503, body: { error: 'Indisponible.' } } : { body: FAMILY } })
  await page.goto('/espace/journal')
  await expect(page).toHaveURL(/\/espace\/journal$/)
  await page.goto('/espace')
  await expect(page.getByRole('alert')).toContainText('Impossible de charger votre famille.')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toHaveCount(0)
  down = false
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible()
})

test('rechargement qui révèle « pas de famille » : retour à la création, jamais un écran vide', async ({ page }) => {
  let state: 'down' | 'none' = 'down'
  await mockApi(page, { ...me, 'GET /api/families/me': () => state === 'down' ? { status: 503, body: { error: 'Indisponible.' } } : noFamily() })
  await page.goto('/espace/famille')
  await expect(page.getByRole('alert')).toContainText('Impossible de charger votre famille.')
  state = 'none'
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toBeVisible()
})

test('renommage refusé (rôle retiré ailleurs) : état rechargé, bouton retiré', async ({ page }) => {
  let role = 'manager'
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, role, members: [{ ...FAMILY.members[0], role }] } }),
    'PATCH /api/families/me': () => { role = 'member'; return { status: 403, body: { error: 'Action réservée aux gestionnaires de la famille.', code: 'family_role' } } }
  })
  await page.goto('/espace/famille')
  await page.getByRole('button', { name: 'Renommer' }).click()
  await page.getByLabel('Nom de la famille').fill('Autre')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('button', { name: 'Renommer' })).toHaveCount(0)
  await expect(page.getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('listitem')).toContainText('Alice (vous)Contact')
  await expect(page.getByRole('alert')).toHaveText('Action non autorisée.')
})

test('session révoquée découverte au chargement de la famille : connexion, puis retour à l’onglet visé', async ({ page }) => {
  // /auth/me répond encore (session vue au démarrage), mais l'appel suivant reçoit 401.
  let revoked = true
  await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/families/me': () => revoked ? { status: 401, body: { error: 'Connexion requise.' } } : { body: FAMILY },
    'POST /api/auth/login': () => { revoked = false; return { body: { user: USER } } }
  })
  await page.goto('/espace/journal')
  await expect(page).toHaveURL(/\/connexion\?next=(\/|%2F)espace(\/|%2F)journal$/)
  await page.fill('#email', USER.email)
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/espace\/journal$/)
  await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible()
})

test('owner : retirer un membre passe par la feuille ; Annuler, Échap et fond ne retirent rien', async ({ page }) => {
  const rivo = { userId: '6f1c2b1e-0000-4000-8000-000000000002', name: 'Rivo', role: 'member', isMe: false }
  let members = [FAMILY.members[0], rivo]
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, members } }),
    'GET /api/families/me/invitations': () => ({ body: [] }),
    [`DELETE /api/families/me/members/${rivo.userId}`]: () => { members = [members[0]]; return { body: { ok: true } } }
  })
  const isDelete = (r: import('@playwright/test').Request) => r.method() === 'DELETE'
  await page.goto('/espace/famille')
  const remove = page.getByRole('button', { name: 'Retirer', exact: true })
  await cancelEveryWay(page, remove, calls, isDelete)
  await expect(page.getByRole('listitem').filter({ hasText: 'Rivo' })).toHaveCount(1)

  await remove.click()
  const sheet = confirmSheet(page, 'Retirer Rivo de la famille ?')
  await expect(sheet.getByRole('listitem')).toHaveText([/coupé tout de suite/, 'son compte est conservé.'])
  expect(calls.filter(isDelete)).toHaveLength(0)
  await sheet.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page.getByText('Rivo')).toHaveCount(0)
  expect(calls.filter(isDelete)).toHaveLength(1)
})

test('quitter la famille : titre et conséquences propres au départ', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ ...FAMILY.members[0], isMe: false, name: 'Hanta' }, { userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: asMember }) })
  await page.goto('/espace/famille')
  await page.getByRole('button', { name: 'Quitter la famille' }).click()
  const sheet = confirmSheet(page, 'Quitter la famille ?')
  await expect(sheet.getByRole('listitem').first()).toHaveText('vous n’aurez plus accès aux enfants de la famille ;')
  await expect(sheet.getByRole('button', { name: 'Confirmer : quitter la famille' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quitter la famille' })).toBeFocused()
  expect(calls.some((r) => r.method() === 'DELETE')).toBe(false)
})
