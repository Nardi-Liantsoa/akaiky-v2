import { expect, test } from '@playwright/test'
import { cancelEveryWay, confirmSheet } from './confirm'
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
  const sheet = confirmSheet(page, 'Supprimer la famille')
  await expect(sheet.getByText('les téléphones des enfants, aussitôt déconnectés ;')).toBeVisible()
  await expect(sheet.getByLabel('Votre mot de passe')).toHaveAttribute('autocomplete', 'current-password')
  // Le champ prend le focus à l'ouverture.
  await expect(sheet.getByLabel('Votre mot de passe')).toBeFocused()
  const confirm = sheet.getByRole('button', { name: 'Supprimer définitivement la famille' })
  await expect(confirm).toBeDisabled()
  expect(calls.some((r) => r.method() === 'DELETE')).toBe(false)

  // Mauvais mot de passe : la feuille reste ouverte, l'erreur s'y affiche.
  await sheet.getByLabel('Votre mot de passe').fill('mauvais')
  await confirm.click()
  await expect(sheet.getByRole('alert')).toHaveText('Mot de passe incorrect.')
  await expect(sheet).toBeVisible()
  // Échec : le mot de passe saisi est effacé, le champ reprend le focus.
  await expect(sheet.getByLabel('Votre mot de passe')).toHaveValue('')
  await expect(sheet.getByLabel('Votre mot de passe')).toBeFocused()

  // Entrée dans le champ : même envoi que le bouton.
  await sheet.getByLabel('Votre mot de passe').fill('cheval batterie agrafe')
  await sheet.getByLabel('Votre mot de passe').press('Enter')
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
  await confirmSheet(page).getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByLabel('Votre mot de passe')).toHaveCount(0)
  expect(calls.some((r) => r.method() === 'DELETE')).toBe(false)
  // Rouverte : le mot de passe saisi n'est pas gardé.
  await page.getByRole('button', { name: 'Supprimer la famille' }).click()
  await expect(page.getByLabel('Votre mot de passe')).toHaveValue('')
})

test('famille et compte : Annuler, Échap et fond referment sans DELETE, focus rendu au bouton', async ({ page }) => {
  const calls = await mockApi(page, { ...me, ...security, 'GET /api/families/me': () => ({ body: FAMILY }) })
  const isDelete = (r: import('@playwright/test').Request) => r.method() === 'DELETE'
  await page.goto('/espace/famille')
  await cancelEveryWay(page, page.getByRole('button', { name: 'Supprimer la famille' }), calls, isDelete)
  await page.goto('/securite')
  await cancelEveryWay(page, page.getByRole('button', { name: 'Supprimer mon compte' }), calls, isDelete)
})

test('pendant l’envoi : feuille occupée, Échap ne la ferme pas', async ({ page }) => {
  let release: () => void = () => {}
  const pending = new Promise<void>((r) => { release = r })
  await mockApi(page, {
    ...me, ...security,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'DELETE /api/auth/me': async () => { await pending; return { status: 400, body: { error: 'x', code: 'wrong_password' } } }
  })
  await page.goto('/securite')
  await page.getByRole('button', { name: 'Supprimer mon compte' }).click()
  const sheet = confirmSheet(page, 'Supprimer mon compte')
  await expect(sheet.getByRole('listitem')).toHaveCount(3)
  await sheet.getByLabel('Votre mot de passe').fill('mauvais')
  await sheet.getByRole('button', { name: 'Supprimer définitivement mon compte' }).click()
  await expect(sheet.getByRole('button', { name: 'Un instant…' })).toBeDisabled()
  await expect(sheet.getByRole('button', { name: 'Annuler' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeVisible()
  release()
  await expect(sheet.getByRole('alert')).toHaveText('Mot de passe incorrect.')
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
  await expect(confirmSheet(page).getByRole('alert')).toContainText('Cédez d’abord ce rôle à un autre membre, ou supprimez la famille.')
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
