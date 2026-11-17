import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const TOKEN = 'T'.repeat(43)
const RIVO = { userId: '6f1c2b1e-0000-4000-8000-000000000002', name: 'Rivo', role: 'member', isMe: false }

test('gestionnaire : inviter, voir l’invitation en attente, l’annuler', async ({ page }) => {
  let invitations: { id: string, email: string, role: string, createdAt: string, expiresAt: string }[] = []
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/families/me/invitations': () => ({ body: invitations }),
    'POST /api/families/me/invitations': (req) => {
      const inv = { id: '6f1c2b1e-0000-4000-8000-0000000000a1', email: req.postDataJSON().email, role: req.postDataJSON().role, createdAt: '2026-11-17T10:00:00Z', expiresAt: '2026-11-24T10:00:00Z' }
      invitations = [inv]
      return { status: 201, body: inv }
    },
    'DELETE /api/families/me/invitations/6f1c2b1e-0000-4000-8000-0000000000a1': () => { invitations = []; return { body: { ok: true } } }
  })
  await page.goto('/espace/famille')
  await page.getByLabel('Adresse e-mail').fill('rivo@exemple.fr')
  await page.getByLabel('Rôle', { exact: true }).selectOption('manager')
  await page.getByRole('button', { name: 'Envoyer l’invitation' }).click()
  await expect(page.getByRole('status')).toHaveText('Invitation envoyée à rivo@exemple.fr.')
  const post = calls.find((r) => r.method() === 'POST' && r.url().endsWith('/invitations'))!
  expect(post.postDataJSON()).toEqual({ email: 'rivo@exemple.fr', role: 'manager' })
  await expect(page.getByRole('heading', { name: 'Invitations en attente' })).toBeVisible()
  await expect(page.getByText('Gestionnaire · valable jusqu’au 24 novembre')).toBeVisible()
  await page.getByRole('button', { name: 'Annuler', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Invitations en attente' })).toHaveCount(0)
})

test('contact : ni invitation ni gestion des autres, seulement « Quitter »', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ ...FAMILY.members[0], isMe: false, name: 'Hanta' }, { userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: asMember }) })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Membres' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Inviter un proche' })).toHaveCount(0)
  await expect(page.getByLabel(/^Rôle de /)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retirer' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quitter la famille' })).toHaveCount(1)
})

test('owner : changer un rôle, retirer en deux temps ; refus « dernier owner » affiché', async ({ page }) => {
  let members = [FAMILY.members[0], RIVO]
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, members } }),
    'GET /api/families/me/invitations': () => ({ body: [] }),
    [`PATCH /api/families/me/members/${RIVO.userId}`]: (req) => { members = [members[0], { ...RIVO, role: req.postDataJSON().role }]; return { body: { userId: RIVO.userId, role: req.postDataJSON().role } } },
    [`DELETE /api/families/me/members/${RIVO.userId}`]: () => { members = [members[0]]; return { body: { ok: true } } },
    [`DELETE /api/families/me/members/${USER.id}`]: () => ({ status: 409, body: { error: '…', code: 'last_owner' } })
  })
  await page.goto('/espace/famille')
  await page.getByLabel('Rôle de Rivo').selectOption('manager')
  await expect(page.getByLabel('Rôle de Rivo')).toHaveValue('manager')
  await page.getByRole('button', { name: 'Retirer' }).click()
  await page.getByRole('button', { name: 'Confirmer le retrait' }).click()
  await expect(page.getByText('Rivo')).toHaveCount(0)
  await page.getByRole('button', { name: 'Quitter la famille' }).click()
  await page.getByRole('button', { name: 'Confirmer : quitter la famille' }).click()
  await expect(page.getByRole('alert')).toHaveText('La famille doit garder au moins un parent principal.')
})

test('lien d’invitation sans session : jeton retiré de l’adresse, connexion puis acceptation', async ({ page }) => {
  let signedIn = false
  let joined = false
  const calls = await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user: signedIn ? USER : null } }),
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'POST /api/auth/login': () => { signedIn = true; return { body: { user: USER } } },
    'POST /api/invitations/preview': () => ({ body: { forThisAccount: true, familyName: 'Famille Rabe', role: 'member' } }),
    'POST /api/invitations/accept': () => { joined = true; return { body: { familyId: FAMILY.id, role: 'member' } } },
    'GET /api/families/me': () => joined ? { body: { ...FAMILY, role: 'member' } } : { status: 404, body: { error: '', code: 'no_family' } }
  })
  await page.goto(`/invitation#invite=${TOKEN}`)
  await expect(page).toHaveURL(/\/invitation$/)
  await expect(page.getByText('Pour accepter, connectez-vous')).toBeVisible()
  await page.getByRole('link', { name: 'Se connecter' }).click()
  await page.fill('#email', USER.email)
  await page.fill('#password', 'une phrase de passe longue')
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/invitation$/)
  await expect(page.getByText('Vous êtes invité à rejoindre « Famille Rabe » comme Contact.')).toBeVisible()
  await page.getByRole('button', { name: 'Rejoindre la famille' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible()
  const accept = calls.find((r) => r.url().endsWith('/api/invitations/accept'))!
  expect(accept.postDataJSON()).toEqual({ token: TOKEN })
  // Le jeton n'a jamais voyagé dans une URL de requête.
  expect(calls.some((r) => r.url().includes(TOKEN))).toBe(false)
})

test('invitation pour un autre compte, ou expirée : message clair', async ({ page }) => {
  let mode: 'other' | 'invalid' = 'other'
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ status: 404, body: { error: '', code: 'no_family' } }),
    'POST /api/invitations/preview': () => mode === 'other' ? { body: { forThisAccount: false } } : { status: 400, body: { error: '', code: 'invite_invalid' } }
  })
  await page.goto(`/invitation#invite=${TOKEN}`)
  await expect(page.getByRole('alert')).toHaveText('Cette invitation est destinée à une autre adresse. Connectez-vous avec le compte invité.')
  mode = 'invalid'
  await page.goto('/espace')
  await page.goto(`/invitation#invite=${TOKEN}`)
  await expect(page.getByRole('alert')).toHaveText('Cette invitation n’est plus valable. Demandez-en une nouvelle.')
  // Invitation morte : plus gardée pour l'onglet.
  await page.goto('/espace')
  await page.goto('/invitation')
  await expect(page.getByText('Aucune invitation à afficher.')).toBeVisible()
})

test('quitter la famille : retour à l’accueil, qui propose d’en créer une', async ({ page }) => {
  const asMember = { ...FAMILY, role: 'member', members: [{ ...FAMILY.members[0], isMe: false, name: 'Hanta' }, { userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
  let left = false
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => left ? { status: 404, body: { error: '', code: 'no_family' } } : { body: asMember },
    [`DELETE /api/families/me/members/${USER.id}`]: () => { left = true; return { body: { ok: true } } }
  })
  await page.goto('/espace/famille')
  await page.getByRole('button', { name: 'Quitter la famille' }).click()
  await page.getByRole('button', { name: 'Confirmer : quitter la famille' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toBeVisible()
})

test('changement de rôle refusé : le menu revient au rôle réel', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, members: [FAMILY.members[0], RIVO] } }),
    'GET /api/families/me/invitations': () => ({ body: [] }),
    [`PATCH /api/families/me/members/${RIVO.userId}`]: () => ({ status: 503, body: { error: 'Indisponible.' } })
  })
  await page.goto('/espace/famille')
  await page.getByLabel('Rôle de Rivo').selectOption('owner')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Rôle de Rivo')).toHaveValue('member')
})
