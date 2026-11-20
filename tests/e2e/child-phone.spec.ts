// Numéro de l'enfant (NAR-194) : champ facultatif du formulaire (gestionnaires), bouton
// « Appeler » (« Antsoy ») de la carte de l'accueil, lien tel: présent seulement avec un numéro.
import { expect, test, type Page, type Request } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

type Kid = { id: string, firstName: string, phone: string | null, avatarColor: string, createdAt: string, parentCodeSetAt: string | null, remoteUnlockUntil: string | null, phoneLastSeenAt: string | null, sosSiren: boolean }
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const kid = (n: number, firstName: string, phone: string | null = null): Kid => ({
  id: `6f1c2b1e-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`, firstName, phone, avatarColor: 'orange',
  createdAt: `2026-11-1${n}T10:00:00Z`, parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false
})
const MEMBER_FAMILY = { ...FAMILY, role: 'member', members: [{ userId: USER.id, name: USER.name, role: 'member', isMe: true }] }
// Normalisation simulée du serveur pour les seuls numéros des tests.
const E164: Record<string, string> = { '034 12 345 67': '+261341234567', '+33 6 12 34 56 78': '+33612345678' }
const callLink = (page: Page, name: string) => page.getByRole('link', { name: `Appeler ${name}` })
const patches = (calls: Request[]) => calls.filter((r) => r.method() === 'PATCH').map((r) => r.postDataJSON())

function childrenApi(initial: Kid[]) {
  let items = [...initial]
  return {
    items: () => items,
    handlers: {
      'GET /api/children': () => ({ body: items }),
      'POST /api/children': (req: Request) => {
        const body = req.postDataJSON()
        const c = { ...kid(items.length + 1, body.firstName), phone: body.phone ? E164[body.phone] : null }
        items = [...items, c]
        return { status: 201, body: c }
      },
      ...Object.fromEntries(initial.map((k) => [`PATCH /api/children/${k.id}`, (req: Request) => {
        const body = req.postDataJSON()
        if (typeof body.phone === 'string' && !E164[body.phone]) return { status: 400, body: { error: 'Numéro de téléphone invalide.', code: 'invalid_phone' } }
        const before = items.find((c) => c.id === k.id)!
        const c = { ...before, ...body, ...(body.phone !== undefined ? { phone: body.phone === null ? null : E164[body.phone] } : {}) }
        items = items.map((x) => (x.id === k.id ? c : x))
        return { body: c }
      }]))
    }
  }
}

test('gestionnaire : numéro saisi, refusé s’il est invalide, puis « Appeler » ouvre tel: ; effacé, le bouton disparaît', async ({ page }) => {
  const fy = kid(1, 'Fy'), tiana = kid(2, 'Tiana', '+261331234567')
  const api = childrenApi([fy, tiana])
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), ...api.handlers })
  await page.goto('/espace')
  // Sans numéro : aucun bouton d'appel ; avec numéro : lien tel: au bon numéro.
  await expect(callLink(page, 'Tiana')).toHaveAttribute('href', 'tel:+261331234567')
  await expect(callLink(page, 'Fy')).toHaveCount(0)
  await expect(page.locator('ul.cards li.child a[href^="tel:"]')).toHaveCount(1)

  await page.goto(`/espace/enfant/${fy.id}`)
  const field = page.getByLabel('Numéro de l’enfant (facultatif)')
  await expect(field).toHaveValue('')
  await expect(field).toHaveAttribute('type', 'tel')
  await expect(field).toHaveAccessibleDescription('Pour l’appeler depuis l’accueil. Laissez vide s’il n’en a pas.')
  // Prénom seul modifié : le numéro n'est pas envoyé.
  await page.getByLabel('Prénom').fill('Fyfy')
  await field.fill('12')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('alert')).toHaveText('Numéro de téléphone invalide.')
  await field.fill('034 12 345 67')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  expect(patches(calls).at(-1)).toEqual({ firstName: 'Fyfy', avatarColor: 'orange', phone: '034 12 345 67' })
  const link = callLink(page, 'Fyfy')
  await expect(link).toHaveAttribute('href', 'tel:+261341234567')
  await expect(link).toHaveText('Appeler')
  // Zone tactile ≥ 48 px.
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48)

  // Rouvert : le numéro enregistré est affiché ; renommer sans y toucher ne le renvoie pas.
  await page.goto(`/espace/enfant/${fy.id}`)
  await expect(field).toHaveValue('+261341234567')
  await page.getByLabel('Prénom').fill('Fy')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  expect(patches(calls).at(-1)).toEqual({ firstName: 'Fy', avatarColor: 'orange' })
  // Vidé : null envoyé, le bouton disparaît.
  await page.goto(`/espace/enfant/${fy.id}`)
  await field.fill('')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace$/)
  expect(patches(calls).at(-1)).toEqual({ firstName: 'Fy', avatarColor: 'orange', phone: null })
  await expect(callLink(page, 'Fy')).toHaveCount(0)
  await expect(callLink(page, 'Tiana')).toBeVisible()
})

test('ajout d’un enfant avec son numéro : envoyé avec le prénom ; sans numéro, rien n’est envoyé', async ({ page }) => {
  const api = childrenApi([])
  const calls = await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), ...api.handlers })
  await page.goto('/espace/enfant/nouveau')
  await page.getByLabel('Prénom').fill('Hery')
  await page.getByLabel('Numéro de l’enfant (facultatif)').fill('+33 6 12 34 56 78')
  await page.getByRole('checkbox', { name: /autorité parentale sur cet enfant/ }).check()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(callLink(page, 'Hery')).toHaveAttribute('href', 'tel:+33612345678')
  const posted = calls.filter((r) => r.method() === 'POST').map((r) => r.postDataJSON())
  expect(posted).toEqual([{ firstName: 'Hery', phone: '+33 6 12 34 56 78', parentalConsent: true }])
})

test('contact (member) : « Appeler » visible avec le numéro, absent sans, et jamais le formulaire', async ({ page }) => {
  const api = childrenApi([kid(1, 'Fy', '+261341234567'), kid(2, 'Tiana')])
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: MEMBER_FAMILY }), ...api.handlers })
  await page.goto('/espace')
  await expect(callLink(page, 'Fy')).toHaveAttribute('href', 'tel:+261341234567')
  await expect(callLink(page, 'Tiana')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actions pour Fy' })).toHaveCount(0)
  // Formulaire réservé aux gestionnaires : renvoyé à l'accueil.
  await page.goto(`/espace/enfant/${api.items()[0].id}`)
  await expect(page).toHaveURL(/\/espace$/)
  await expect(page.getByLabel('Numéro de l’enfant (facultatif)')).toHaveCount(0)
})

test('malgache : le bouton s’appelle « Antsoy »', async ({ page }) => {
  const api = childrenApi([kid(1, 'Fy', '+261341234567')])
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), ...api.handlers })
  await page.addInitScript(() => { try { localStorage.setItem('akaiky-v2.lang', 'mg') } catch { /* ignoré */ } })
  await page.goto('/espace')
  await expect(page.getByRole('link', { name: 'Antsoy i Fy' })).toHaveText('Antsoy')
})
