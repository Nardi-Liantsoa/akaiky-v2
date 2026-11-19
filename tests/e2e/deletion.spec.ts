import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

// Suppression de la famille et du compte (NAR-177).
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }) }
const noFamily = () => ({ status: 404, body: { error: 'Famille introuvable.', code: 'no_family' } })
const security = {
  'GET /api/auth/security': () => ({ body: { devices: [], mfaEnabled: false, recoveryCodesRemaining: 0 } }),
  'GET /api/auth/app-sessions': () => ({ body: [] })
}

test('owner : la zone sensible demande le mot de passe, envoie DELETE puis montre l’état sans famille', async ({ page }) => {
  let deleted = false
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => deleted ? noFamily() : { body: FAMILY },
    'GET /api/children': () => ({ body: [] }),
    'GET /api/families/me/invitations': () => ({ body: [] }),
    'DELETE /api/families/me': (req) => {
      if (req.postDataJSON().password !== 'cheval batterie agrafe') return { status: 400, body: { error: 'Mot de passe incorrect.', code: 'wrong_password' } }
      deleted = true
      return { body: { ok: true } }
    }
  })
  await page.goto('/espace/famille')
  await expect(page.getByRole('heading', { name: 'Zone sensible' })).toBeVisible()
  await page.getByRole('button', { name: 'Supprimer la famille' }).click()
  await expect(page.getByText('les téléphones des enfants, aussitôt déconnectés ;')).toBeVisible()
  await expect(page.getByLabel('Votre mot de passe')).toHaveAttribute('autocomplete', 'current-password')
  const confirm = page.getByRole('button', { name: 'Supprimer définitivement la famille' })
  await expect(confirm).toBeDisabled()

  await page.getByLabel('Votre mot de passe').fill('mauvais')
  await confirm.click()
  await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect.')

  await page.getByLabel('Votre mot de passe').fill('cheval batterie agrafe')
  await confirm.click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('status')).toHaveText('La famille a été supprimée. Vous pouvez en créer une nouvelle.')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toBeVisible()
  const del = calls.filter((r) => r.method() === 'DELETE' && r.url().endsWith('/api/families/me'))
  expect(del).toHaveLength(2)
  expect(del[1].postDataJSON()).toEqual({ password: 'cheval batterie agrafe' })
  expect(del[1].headers()['x-app']).toBe('1')
})

test('annuler referme la confirmation sans rien envoyer', async ({ page }) => {
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }) })
  await page.goto('/espace/famille')
  await page.getByRole('button', { name: 'Supprimer la famille' }).click()
  await page.getByLabel('Votre mot de passe').fill('x')
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByLabel('Votre mot de passe')).toHaveCount(0)
  expect(calls.some((r) => r.method() === 'DELETE')).toBe(false)
})

test('gestionnaire et contact : pas de zone sensible', async ({ page }) => {
  for (const role of ['manager', 'member']) {
    const asOther = { ...FAMILY, role, members: [{ ...FAMILY.members[0], isMe: false }, { userId: USER.id, name: USER.name, role, isMe: true }] }
    await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: asOther }) })
    await page.goto('/espace/famille')
    await expect(page.getByRole('heading', { name: 'Famille Rabe' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Zone sensible' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Supprimer la famille' })).toHaveCount(0)
    await page.unrouteAll()
  }
})

test('sécurité : un parent principal reçoit l’explication (409) avec le lien vers la famille', async ({ page }) => {
  const calls = await mockApi(page, {
    ...me, ...security,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'DELETE /api/auth/me': () => ({ status: 409, body: { error: 'Cédez d’abord le rôle.', code: 'owner_must_transfer_or_delete' } })
  })
  await page.goto('/securite')
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click()
  await page.getByLabel('Votre mot de passe').fill('cheval batterie agrafe')
  await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click()
  await expect(page.getByRole('alert')).toContainText('Cédez d’abord ce rôle à un autre membre, ou supprimez la famille.')
  expect(calls.find((r) => r.method() === 'DELETE')!.postDataJSON()).toEqual({ password: 'cheval batterie agrafe' })
  await page.getByRole('link', { name: 'Aller à l’écran Famille' }).click()
  await expect(page).toHaveURL(/\/espace\/famille$/)
})

test('sécurité : compte supprimé, déconnexion locale et confirmation sur la connexion', async ({ page }) => {
  let gone = false
  await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user: gone ? null : USER } }),
    ...security,
    'DELETE /api/auth/me': () => { gone = true; return { body: { ok: true } } },
    'POST /api/auth/logout': () => ({ body: { ok: true } })
  })
  await page.goto('/securite')
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click()
  await page.getByLabel('Votre mot de passe').fill('cheval batterie agrafe')
  await page.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click()
  await expect(page).toHaveURL(/\/connexion/)
  await expect(page.getByRole('status')).toHaveText('Votre compte a été supprimé.')
})
