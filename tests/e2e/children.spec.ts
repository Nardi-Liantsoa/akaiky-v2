import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

type Kid = { id: string, firstName: string, avatarColor: string, createdAt: string, parentCodeSetAt: string | null, remoteUnlockUntil: string | null, phoneLastSeenAt: string | null, sosSiren: boolean }
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const kid = (n: number, firstName: string, avatarColor = 'orange'): Kid => ({ id: `6f1c2b1e-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, firstName, avatarColor, createdAt: `2026-11-1${n}T10:00:00Z`, parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false })

// API des enfants simulée avec un état (ajouts, modifications, retraits).
function childrenApi(initial: Kid[] = []) {
  let items = [...initial]
  let next = initial.length + 1
  const handlers: Record<string, (req: import('@playwright/test').Request) => { status?: number, body?: unknown }> = {
    'GET /api/children': () => ({ body: items }),
    'POST /api/children': (req) => {
      const c = kid(next++, req.postDataJSON().firstName, req.postDataJSON().avatarColor)
      items = [...items, c]
      return { status: 201, body: c }
    }
  }
  return { handlers, items: () => items, set: (v: Kid[]) => { items = v } }
}

// Carte d'un enfant sur l'accueil (NAR-174) : bouton dont le nom commence par le prénom.
const cardButton = (page: import('@playwright/test').Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name} `) })
const cardNames = (page: import('@playwright/test').Page) => page.locator('ul.cards li.child .name')

test('owner sans enfant : ajouter deux enfants, cartes empilées, sélection gardée après rechargement', async ({ page }) => {
  const api = childrenApi()
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), ...api.handlers })
  await page.goto('/espace')
  await expect(page.getByText('Ajoutez votre premier enfant pour configurer son téléphone.')).toBeVisible()
  await page.getByRole('link', { name: 'Ajouter un enfant' }).click()
  await page.getByLabel('Prénom').fill('Fy')
  // Sans la case de consentement : message, rien n'est envoyé (NAR-178).
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('alert')).toHaveText('Cochez cette case pour continuer.')
  expect(calls.some((r) => r.method() === 'POST' && r.url().endsWith('/api/children'))).toBe(false)
  // Toute la ligne est cliquable : le texte coche la case.
  await page.getByText('Je suis titulaire de l’autorité parentale sur cet enfant').click()
  await expect(page.getByRole('checkbox', { name: /autorité parentale sur cet enfant/ })).toBeChecked()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(cardButton(page, 'Fy')).toBeVisible()
  await expect(cardButton(page, 'Fy')).toContainText('Aucun téléphone relié')
  // Sans couleur choisie, rien n'est envoyé : la rotation est celle du serveur.
  expect(calls.find((r) => r.method() === 'POST' && r.url().endsWith('/api/children'))!.postDataJSON()).toEqual({ firstName: 'Fy', parentalConsent: true })

  await page.getByRole('link', { name: '+ Ajouter un enfant' }).click()
  await page.getByLabel('Prénom').fill('Tiana')
  await page.getByLabel('Violet').check()
  await page.getByRole('checkbox', { name: /autorité parentale sur cet enfant/ }).check()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(cardNames(page)).toHaveText(['Fy', 'Tiana'])
  // L'enfant tout juste ajouté est sélectionné : sa carte est dépliée.
  await expect(cardButton(page, 'Tiana')).toHaveAttribute('aria-current', 'true')
  await expect(cardButton(page, 'Fy')).not.toHaveAttribute('aria-current', 'true')
  expect(api.items().map((c) => [c.firstName, c.avatarColor])).toEqual([['Fy', 'orange'], ['Tiana', 'violet']])

  await cardButton(page, 'Fy').click()
  await page.reload()
  await expect(cardButton(page, 'Fy')).toHaveAttribute('aria-current', 'true')
  await cardButton(page, 'Tiana').click()
  await page.reload()
  await expect(cardButton(page, 'Tiana')).toHaveAttribute('aria-current', 'true')
})

test('renommer puis retirer un enfant par le menu « ⋯ » (retrait en deux temps)', async ({ page }) => {
  const api = childrenApi([kid(1, 'Fy'), kid(2, 'Tiana', 'blue')])
  const fy = api.items()[0]
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    ...api.handlers,
    [`PATCH /api/children/${fy.id}`]: (req) => { const c = { ...fy, ...req.postDataJSON() }; api.set([c, api.items()[1]]); return { body: c } },
    [`DELETE /api/children/${fy.id}`]: () => { api.set(api.items().slice(1)); return { body: { ok: true } } }
  })
  await page.goto('/espace')
  await page.getByRole('button', { name: 'Actions pour Fy' }).click()
  await expect(page.getByRole('dialog', { name: 'Actions pour Fy' })).toBeVisible()
  // Échap ferme la feuille, le focus revient sur « ⋯ ».
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actions pour Fy' })).toBeFocused()
  await page.getByRole('button', { name: 'Actions pour Fy' }).click()
  await page.getByRole('link', { name: 'Modifier' }).click()
  await expect(page.getByRole('heading', { name: 'Modifier Fy' })).toBeVisible()
  await expect(page.getByLabel('Prénom')).toHaveValue('Fy')
  await page.getByLabel('Prénom').fill('Fyfy')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(cardButton(page, 'Fyfy')).toBeVisible()

  await page.getByRole('button', { name: 'Actions pour Fyfy' }).click()
  await page.getByRole('link', { name: 'Modifier' }).click()
  await page.getByRole('button', { name: 'Retirer cet enfant' }).click()
  await page.getByRole('button', { name: 'Confirmer : retirer cet enfant' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(cardNames(page)).toHaveText(['Tiana'])
})

test('contact : voit les enfants, ni ajout ni menu', async ({ page }) => {
  const api = childrenApi([kid(1, 'Fy')])
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }), ...api.handlers })
  await page.goto('/espace')
  await expect(cardButton(page, 'Fy')).toBeVisible()
  await expect(page.getByRole('link', { name: '+ Ajouter un enfant' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actions pour Fy' })).toHaveCount(0)
  // Adresse du formulaire tapée à la main : retour à l'accueil.
  await page.goto('/espace/enfant/nouveau')
  await expect(page).toHaveURL(/\/espace$/)
})

test('enfant inconnu ou d’une autre famille : message, pas de formulaire', async ({ page }) => {
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), ...childrenApi([kid(1, 'Fy')]).handlers })
  await page.goto('/espace/enfant/6f1c2b1e-0000-4000-8000-0000000009ff')
  await expect(page.getByRole('alert')).toHaveText('Cet enfant n’existe plus.')
  await expect(page.getByLabel('Prénom')).toHaveCount(0)
})

test('plafond atteint : message traduit', async ({ page }) => {
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [] }),
    'POST /api/children': () => ({ status: 409, body: { error: '…', code: 'too_many_children' } })
  })
  await page.goto('/espace/enfant/nouveau')
  await page.getByLabel('Prénom').fill('Encore')
  await page.getByRole('checkbox', { name: /autorité parentale sur cet enfant/ }).check()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('alert')).toHaveText('Nombre maximal d’enfants atteint.')
})

test('modification avec la liste en échec : erreur et « Réessayer », jamais un ajout', async ({ page }) => {
  let down = true
  const calls = await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => down ? { status: 503, body: { error: 'Indisponible.' } } : { body: [kid(1, 'Fy')] }
  })
  await page.goto(`/espace/enfant/${kid(1, 'Fy').id}`)
  await expect(page.getByRole('alert')).toContainText('Impossible de charger les enfants.')
  await expect(page.getByLabel('Prénom')).toHaveCount(0)
  down = false
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByLabel('Prénom')).toHaveValue('Fy')
  expect(calls.some((r) => r.method() === 'POST')).toBe(false)
})

test('rôle retiré pendant la modification : famille relue, retour à l’accueil sans bouton', async ({ page }) => {
  let role = 'manager'
  const fy = kid(1, 'Fy')
  await mockApi(page, {
    ...me,
    'GET /api/families/me': () => ({ body: { ...FAMILY, role } }),
    'GET /api/children': () => ({ body: [fy] }),
    [`PATCH /api/children/${fy.id}`]: () => { role = 'member'; return { status: 403, body: { error: '…', code: 'family_role' } } }
  })
  await page.goto(`/espace/enfant/${fy.id}`)
  await page.getByLabel('Prénom').fill('Autre')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0)
})
