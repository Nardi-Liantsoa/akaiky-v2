import { expect, test, type Request } from '@playwright/test'
import { cancelEveryWay, confirmSheet } from './confirm'
import { FAMILY, mockApi, USER } from './mock'
import { openSection, row } from './settings'

type C = { id: string, childId: string, name: string, phone: string, position: number, avatarColor: string, memberUserId: string | null, memberRole: string | null }
const me = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) }
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
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
  await openSection(page, 'Contacts autorisés')
  await expect(page.getByText('Téléphone de Fy')).toBeVisible()
  await expect(page.getByText('1 sur 6')).toBeVisible()
  await page.getByRole('link', { name: '+ Ajouter un contact' }).click()
  await page.getByLabel('Nom affiché').fill('Papa')
  await page.getByLabel('Numéro de téléphone').fill('034 12 345 67')
  await page.getByLabel('Membre de la famille').selectOption({ label: 'Alice · Parent principal' })
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
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
  await openSection(page, 'Contacts autorisés')
  await expect(page.getByText('6 sur 6')).toBeVisible()
  await expect(page.getByRole('link', { name: '+ Ajouter un contact' })).toHaveCount(0)

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page, { ...common, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }), ...contactsApi(six.slice(0, 2)).handlers })
  await openSection(page, 'Contacts autorisés')
  await expect(page.getByText('2 sur 6')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Monter / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Modifier / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '+ Ajouter un contact' })).toHaveCount(0)
  await page.goto(`/espace/reglages/enfant/${FY.id}/contact/nouveau`)
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
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
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  // Seul le champ modifié part.
  const body = calls.find((r) => r.method() === 'PATCH')!.postDataJSON()
  expect(body).toEqual({ name: 'Papa Rakoto' })
})

test('retirer un contact : feuille de confirmation, rien ne part avant « Confirmer », retour aux Réglages', async ({ page }) => {
  const api = contactsApi([
    { id: cid(1), name: 'Maman', phone: '+261341111111', avatarColor: 'orange', memberUserId: null, memberRole: null },
    { id: cid(2), name: 'Mamie', phone: '+261321111111', avatarColor: 'violet', memberUserId: null, memberRole: null }
  ])
  let removed = false
  const calls = await mockApi(page, {
    ...common,
    ...api.handlers,
    [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: removed ? api.items().slice(1) : api.items() } }),
    [`DELETE /api/contacts/${cid(1)}`]: () => { removed = true; return { body: { ok: true } } }
  })
  const isDelete = (r: Request) => r.method() === 'DELETE'
  await page.goto(`/espace/reglages/enfant/${FY.id}/contact/${cid(1)}`)
  const remove = page.getByRole('button', { name: 'Retirer ce contact' })
  await cancelEveryWay(page, remove, calls, isDelete)
  await expect(page.getByLabel('Nom affiché')).toHaveValue('Maman')

  await remove.click()
  const sheet = confirmSheet(page, 'Retirer Maman ?')
  await expect(sheet.getByRole('listitem')).toHaveCount(2)
  expect(calls.filter(isDelete)).toHaveLength(0)
  await sheet.getByRole('button', { name: 'Confirmer : retirer ce contact' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  await expect(page.getByText('1 sur 6')).toBeVisible()
  expect(calls.filter(isDelete).map((r) => new URL(r.url()).pathname)).toEqual([`/api/contacts/${cid(1)}`])
})

test('retrait d’un contact refusé : feuille refermée, erreur sur la page', async ({ page }) => {
  const api = contactsApi([{ id: cid(1), name: 'Maman', phone: '+261341111111', avatarColor: 'orange', memberUserId: null, memberRole: null }])
  await mockApi(page, { ...common, ...api.handlers, [`DELETE /api/contacts/${cid(1)}`]: () => ({ status: 500, body: { error: 'Erreur.' } }) })
  await page.goto(`/espace/reglages/enfant/${FY.id}/contact/${cid(1)}`)
  const remove = page.getByRole('button', { name: 'Retirer ce contact' })
  await remove.click()
  await confirmSheet(page).getByRole('button', { name: 'Confirmer : retirer ce contact' }).click()
  await expect(confirmSheet(page)).toHaveCount(0)
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(remove).toBeFocused()
  await expect(page).toHaveURL(new RegExp(`/contact/${cid(1)}$`))
})

test('changement d’enfant : la carte des contacts reste en place, estompée, jusqu’à la nouvelle liste (pas de clignement)', async ({ page }) => {
  const TIANA = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Tiana', avatarColor: 'green' }
  let release!: () => void
  const slow = new Promise<void>((r) => { release = r })
  const api = contactsApi([{ id: cid(1), name: 'Maman', phone: '+261341111111', avatarColor: 'orange', memberUserId: null, memberRole: null }])
  await mockApi(page, { ...common, 'GET /api/children': () => ({ body: [FY, TIANA] }), ...api.handlers })
  // Liste de Tiana retenue : déclarée après mockApi, cette route passe en premier.
  await page.route(`**/api/children/${TIANA.id}/contacts`, async (route) => {
    await slow
    await route.fulfill({ json: { version: 1, max: 6, country: 'MG', contacts: [{ id: cid(9), childId: TIANA.id, name: 'Dadabe', phone: '+261331112233', position: 1, avatarColor: 'blue', memberUserId: null, memberRole: null }] } })
  })
  await openSection(page, 'Contacts autorisés')
  await expect(page.getByText('Maman')).toBeVisible()
  // Sélecteur compact (NAR-174) : « Fy ▾ », puis Tiana dans la liste.
  await page.getByRole('button', { name: /Enfant affiché : Fy/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Tiana/ }).click()
  // Pendant le chargement : la carte est toujours là (ancienne liste estompée, inactive).
  const card = page.locator('section.contacts')
  await expect(card).toHaveAttribute('aria-busy', 'true')
  await expect(card).toBeVisible()
  release()
  await expect(page.getByText('Dadabe')).toBeVisible()
  await expect(card).toHaveAttribute('aria-busy', 'false')
})

test('fiche contact : Annuler, Enregistrer et le retour de l’historique mènent à la section Contacts, pas au résumé', async ({ page }) => {
  const api = contactsApi([{ id: cid(1), name: 'Maman', phone: '+261341111111', avatarColor: 'orange', memberUserId: null, memberRole: null }])
  await mockApi(page, { ...common, ...api.handlers })
  await openSection(page, 'Contacts autorisés')
  // Annuler : retour à la section, sans nouvelle entrée dans l'historique.
  await page.getByRole('link', { name: '+ Ajouter un contact' }).click()
  await page.getByRole('link', { name: 'Annuler' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts autorisés' })).toBeVisible()
  // Retour de l'historique (bouton Android) depuis la fiche : la section aussi.
  await page.getByRole('link', { name: 'Modifier Maman' }).click()
  await expect(page.getByLabel('Nom affiché')).toHaveValue('Maman')
  await page.goBack()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  // Enregistrer : la section, liste relue ; un retour de plus mène au résumé.
  await page.getByRole('link', { name: '+ Ajouter un contact' }).click()
  await page.getByLabel('Nom affiché').fill('Papa')
  await page.getByLabel('Numéro de téléphone').fill('034 12 345 67')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  await expect(page.getByText('2 sur 6')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/espace\/reglages$/)
  await expect(row(page, 'Contacts autorisés')).toContainText('2 sur 6')
})

test('fiche contact ouverte par son adresse (« Autoriser » du journal, autre enfant) : l’enregistrement mène à la section Contacts de cet enfant', async ({ page }) => {
  const TIANA = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Tiana', avatarColor: 'green' }
  await mockApi(page, {
    ...common,
    'GET /api/children': () => ({ body: [FY, TIANA] }),
    ...contactsApi().handlers,
    [`GET /api/children/${TIANA.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
    [`POST /api/children/${TIANA.id}/contacts`]: () => ({ status: 201, body: { id: cid(7), childId: TIANA.id, name: 'Dadabe', phone: '+261341234567', position: 1, avatarColor: 'blue', memberUserId: null, memberRole: null } })
  })
  await page.goto(`/espace/reglages/enfant/${TIANA.id}/contact/nouveau`)
  await page.getByLabel('Nom affiché').fill('Dadabe')
  await page.getByLabel('Numéro de téléphone').fill('034 12 345 67')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/espace\/reglages\/contacts$/)
  await expect(page.getByRole('button', { name: /Enfant affiché : Tiana/ })).toBeVisible()
})
