import { expect, test, type Request } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

type C = { id: string, childId: string, name: string, phone: string, position: number, avatarColor: string, memberUserId: string | null, memberRole: string | null }
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null }
const cid = (n: number) => `6f1c2b1e-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`

// API des contacts simulée avec un état (ajout, réorganisation).
function contactsApi(initial: Omit<C, 'childId' | 'position'>[] = []) {
  let items: C[] = initial.map((c, i) => ({ ...c, childId: FY.id, position: i + 1 }))
  let version = 1
  let next = items.length + 1
  const base = `/api/children/${FY.id}/contacts`
  const handlers: Record<string, (req: Request) => { status?: number, body?: unknown }> = {
    [`GET ${base}`]: () => ({ body: { version, max: 6, country: 'MG', contacts: items } }),
    [`POST ${base}`]: (req) => {
      const b = req.postDataJSON()
      if (items.length >= 6) return { status: 409, body: { error: '…', code: 'too_many_contacts' } }
      const c: C = { id: cid(next++), childId: FY.id, name: b.name, phone: '+261341234567', position: items.length + 1, avatarColor: b.avatarColor ?? 'orange', memberUserId: b.memberUserId ?? null, memberRole: b.memberUserId ? 'owner' : null }
      items = [...items, c]; version++
      return { status: 201, body: c }
    },
    [`PUT ${base}/order`]: (req) => {
      const ids: string[] = req.postDataJSON().ids
      items = ids.map((id, i) => ({ ...items.find((c) => c.id === id)!, position: i + 1 })); version++
      return { body: { ok: true } }
    }
  }
  return { handlers, items: () => items }
}
const common = { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/children': () => ({ body: [FY] }) }

test('ajouter un contact puis le faire monter : liste, compteur et ordre', async ({ page }) => {
  const api = contactsApi([{ id: cid(1), name: 'Maman', phone: '+261341111111', avatarColor: 'orange', memberUserId: null, memberRole: null }])
  const calls = await mockApi(page, { ...common, ...api.handlers })
  await page.goto('/espace/reglages')
  await expect(page.getByText('Téléphone de Fy')).toBeVisible()
  await expect(page.getByText('1 sur 6')).toBeVisible()
  await page.getByRole('link', { name: '+ Ajouter un contact' }).click()
  await page.getByLabel('Nom affiché').fill('Papa')
  await page.getByLabel('Numéro de téléphone').fill('034 12 345 67')
  await page.getByLabel('Membre de la famille').selectOption({ label: 'Alice · Parent principal' })
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  await expect(page.getByText('2 sur 6')).toBeVisible()
  const post = calls.find((r) => r.method() === 'POST')!.postDataJSON()
  expect(post).toEqual({ name: 'Papa', phone: '034 12 345 67', memberUserId: USER.id })
  // Ajout sans membre lié : le champ n'est pas envoyé.
  await page.getByRole('link', { name: '+ Ajouter un contact' }).click()
  await expect(page.getByLabel('Numéro de téléphone')).toHaveAttribute('placeholder', '034 12 345 67')
  await page.getByLabel('Nom affiché').fill('Mamie')
  await page.getByLabel('Numéro de téléphone').fill('033 12 345 67')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('3 sur 6')).toBeVisible()
  expect(calls.filter((r) => r.method() === 'POST')[1].postDataJSON()).toEqual({ name: 'Mamie', phone: '033 12 345 67' })

  await expect(page.getByText('+261 34 12 345 67').first()).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Papa' })).toContainText('Parent principal')

  await page.getByRole('button', { name: 'Monter Papa' }).click()
  await expect(page.getByRole('listitem').first()).toContainText('Papa')
  expect(api.items().map((c) => c.name)).toEqual(['Papa', 'Maman', 'Mamie'])
  // Premier de la liste : ne peut plus monter.
  await expect(page.getByRole('button', { name: 'Monter Papa' })).toBeDisabled()
})

test('numéro refusé par le serveur : message traduit, rien n’est ajouté', async ({ page }) => {
  await mockApi(page, {
    ...common,
    ...contactsApi().handlers,
    [`POST /api/children/${FY.id}/contacts`]: () => ({ status: 400, body: { error: '…', code: 'invalid_phone' } })
  })
  await page.goto(`/espace/reglages/enfant/${FY.id}/contact/nouveau`)
  await page.getByLabel('Nom affiché').fill('Maman')
  await page.getByLabel('Numéro de téléphone').fill('12345678')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('alert')).toHaveText('Numéro de téléphone invalide.')
  await expect(page).toHaveURL(/\/contact\/nouveau$/)
})

test('six contacts : plus de lien d’ajout ; contact de famille : lecture seule', async ({ page }) => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: cid(i + 1), name: `Contact ${i + 1}`, phone: `+26134000000${i}`, avatarColor: 'blue', memberUserId: null, memberRole: null }))
  await mockApi(page, { ...common, ...contactsApi(six).handlers })
  await page.goto('/espace/reglages')
  await expect(page.getByText('6 sur 6')).toBeVisible()
  await expect(page.getByRole('link', { name: '+ Ajouter un contact' })).toHaveCount(0)

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page, { ...common, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }), ...contactsApi(six.slice(0, 2)).handlers })
  await page.goto('/espace/reglages')
  await expect(page.getByText('2 sur 6')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Monter / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Modifier / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '+ Ajouter un contact' })).toHaveCount(0)
  await page.goto(`/espace/reglages/enfant/${FY.id}/contact/nouveau`)
  await expect(page).toHaveURL(/\/espace\/reglages$/)
})

test('sans enfant : Réglages invite à en ajouter un', async ({ page }) => {
  await mockApi(page, { ...me, 'GET /api/families/me': () => ({ body: FAMILY }), 'GET /api/children': () => ({ body: [] }) })
  await page.goto('/espace/reglages')
  await expect(page.getByText('Ajoutez d’abord un enfant pour régler son téléphone.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Réglages' })).toHaveAttribute('aria-current', 'page')
})

test('modifier le nom d’un contact lié : le membre lié n’est pas renvoyé', async ({ page }) => {
  const linked = { id: cid(1), name: 'Papa', phone: '+261341111111', avatarColor: 'blue', memberUserId: '6f1c2b1e-0000-4000-8000-0000000000aa', memberRole: 'manager' }
  const calls = await mockApi(page, {
    ...common,
    ...contactsApi([linked]).handlers,
    [`PATCH /api/contacts/${cid(1)}`]: (req) => ({ body: { ...linked, childId: FY.id, position: 1, name: req.postDataJSON().name } })
  })
  await page.goto(`/espace/reglages/enfant/${FY.id}/contact/${cid(1)}`)
  await expect(page.getByLabel('Nom affiché')).toHaveValue('Papa')
  await page.getByLabel('Nom affiché').fill('Papa Rakoto')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  // Seul le champ modifié part.
  const body = calls.find((r) => r.method() === 'PATCH')!.postDataJSON()
  expect(body).toEqual({ name: 'Papa Rakoto' })
})
