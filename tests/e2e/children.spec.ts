import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

type Kid = { id: string, firstName: string, avatarColor: string, createdAt: string }
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const kid = (n: number, firstName: string, avatarColor = 'orange'): Kid => ({ id: `6f1c2b1e-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, firstName, avatarColor, createdAt: `2026-11-1${n}T10:00:00Z` })

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

test('owner sans enfant : ajouter deux enfants, puces affichées, sélection gardée après rechargement', async ({ page }) => {
  const api = childrenApi()
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), ...api.handlers })
  await page.goto('/espace')
  await expect(page.getByText('Ajoutez votre premier enfant pour configurer son téléphone.')).toBeVisible()
  await page.getByRole('link', { name: 'Ajouter un enfant' }).click()
  await page.getByLabel('Prénom').fill('Fy')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('heading', { name: 'Fy' })).toBeVisible()

  await page.getByRole('link', { name: 'Ajouter un enfant' }).click()
  await page.getByLabel('Prénom').fill('Tiana')
  await page.getByLabel('Violet').check()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  const picker = page.getByRole('group', { name: 'Enfants de la famille' })
  await expect(picker.getByRole('button')).toHaveText(['FFy', 'TTiana'])
  // L'enfant tout juste ajouté est sélectionné.
  await expect(picker.getByRole('button', { name: 'Tiana' })).toHaveAttribute('aria-pressed', 'true')
  expect(api.items().map((c) => [c.firstName, c.avatarColor])).toEqual([['Fy', 'orange'], ['Tiana', 'violet']])

  await picker.getByRole('button', { name: 'Fy' }).click()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Enfants de la famille' }).getByRole('button', { name: 'Fy' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('group', { name: 'Enfants de la famille' }).getByRole('button', { name: 'Tiana' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tiana' })).toBeVisible()
})

test('renommer puis retirer un enfant (retrait en deux temps)', async ({ page }) => {
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
  await page.getByRole('link', { name: 'Modifier' }).click()
  await expect(page.getByRole('heading', { name: 'Modifier Fy' })).toBeVisible()
  await expect(page.getByLabel('Prénom')).toHaveValue('Fy')
  await page.getByLabel('Prénom').fill('Fyfy')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'Fyfy' })).toBeVisible()

  await page.getByRole('link', { name: 'Modifier' }).click()
  await page.getByRole('button', { name: 'Retirer cet enfant' }).click()
  await page.getByRole('button', { name: 'Confirmer : retirer cet enfant' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByRole('group', { name: 'Enfants de la famille' }).getByRole('button')).toHaveText(['TTiana'])
})

test('contact : voit les enfants, ni ajout ni modification', async ({ page }) => {
  const api = childrenApi([kid(1, 'Fy')])
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }), ...api.handlers })
  await page.goto('/espace')
  await expect(page.getByRole('heading', { name: 'Fy' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ajouter un enfant' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Modifier' })).toHaveCount(0)
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
