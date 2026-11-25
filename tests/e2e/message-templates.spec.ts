import { expect, test, type Request } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'
import { openSection } from './settings'

// Textes des messages rapides (NAR-173) : Réglages, gestionnaire et contact.
const FY = { id: '6f1c2b1e-0000-4000-8000-000000000101', firstName: 'Fy', avatarColor: 'yellow', createdAt: '2026-11-10T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: null, sosSiren: false }
const base = `/api/children/${FY.id}/message-templates`

function templatesApi(initial: Record<number, string | null> = {}) {
  const texts: Record<number, string | null> = { 1: null, 2: null, 3: null, 4: null, ...initial }
  const puts: { slot: number, text: string | null }[] = []
  const handlers: Record<string, (req: Request) => { status?: number, body?: unknown }> = {
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/children': () => ({ body: [FY] }),
    [`GET /api/children/${FY.id}/contacts`]: () => ({ body: { version: 1, max: 6, country: 'MG', contacts: [] } }),
    [`GET ${base}`]: () => ({ body: [1, 2, 3, 4].map((slot) => ({ slot, text: texts[slot] })) })
  }
  for (const slot of [1, 2, 3, 4]) {
    handlers[`PUT ${base}/${slot}`] = (req) => {
      const { text } = req.postDataJSON()
      texts[slot] = text
      puts.push({ slot, text })
      return { body: { slot, text } }
    }
  }
  return { handlers, puts }
}

test('le gestionnaire modifie un texte, puis le remet par défaut ; seul ce qui change part', async ({ page }) => {
  const api = templatesApi({ 3: 'Bus en retard' })
  await mockApi(page, api.handlers)
  await openSection(page, 'Messages rapides')
  await expect(page.getByRole('heading', { name: 'Messages rapides' })).toBeVisible()
  const save = page.getByRole('button', { name: 'Enregistrer les messages' })
  // Bouton jamais grisé (NAR-222) : sans changement, il le dit et n'envoie rien.
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByRole('status').filter({ hasText: 'Aucune modification à enregistrer.' })).toBeVisible()
  expect(api.puts).toEqual([])
  await expect(page.getByLabel('Message 3')).toHaveValue('Bus en retard')
  // Gestionnaire : le champ seul, pas le texte en lecture seule en plus.
  await expect(page.locator('#template-3')).toHaveCount(1)
  await expect(page.locator('.readonly')).toHaveCount(0)
  await expect(page.getByLabel('Message 2')).toHaveAttribute('placeholder', 'Viens me chercher')

  await page.getByLabel('Message 2').fill('Viens me chercher à l’école')
  await save.click()
  await expect(page.getByText('Enregistré. Le téléphone l’affichera')).toBeVisible()
  expect(api.puts).toEqual([{ slot: 2, text: 'Viens me chercher à l’école' }])

  // « Texte par défaut » vide le champ ; enregistré, il envoie null.
  await page.getByRole('listitem').filter({ has: page.getByLabel('Message 3') }).getByRole('button', { name: 'Texte par défaut' }).click()
  await expect(page.getByLabel('Message 3')).toHaveValue('')
  await save.click()
  await expect.poll(() => api.puts.at(-1)).toEqual({ slot: 3, text: null })
  // Plus de 40 caractères (comptés comme le serveur) : signalé, enregistrement bloqué.
  await page.getByLabel('Message 1').fill('x'.repeat(41))
  await expect(page.getByText('Entre 1 et 40 caractères.')).toBeVisible()
  // Envoyé quand même : rien ne part, le focus va au champ fautif.
  const before = api.puts.length
  await save.click()
  await expect(page.getByLabel('Message 1')).toBeFocused()
  expect(api.puts.length).toBe(before)
  await page.getByLabel('Message 1').fill('😀'.repeat(40))
  await expect(page.getByText('Entre 1 et 40 caractères.')).toHaveCount(0)
})

test('un contact de famille voit les textes sans pouvoir les modifier', async ({ page }) => {
  const api = templatesApi({ 1: 'Arrivé à la maison' })
  await mockApi(page, { ...api.handlers, 'GET /api/families/me': () => ({ body: { ...FAMILY, role: 'member' } }) })
  await openSection(page, 'Messages rapides')
  await expect(page.getByText('Arrivé à la maison')).toBeVisible()
  await expect(page.getByText('Tout va bien')).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Message / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Enregistrer les messages' })).toHaveCount(0)
})

// Page seule depuis NAR-185 (plus de carte « Code parent » au-dessus) : la carte, la plus
// longue des sections, finit au-dessus de la barre d'onglets, sur un téléphone de 360 px.
test('Réglages › Messages rapides : la fin de la carte n’est pas cachée par la barre d’onglets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await mockApi(page, templatesApi().handlers)
  await openSection(page, 'Messages rapides')
  await expect(page.getByLabel('Message 4')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const card = await page.locator('#messages-rapides').boundingBox()
  const tabs = await page.getByRole('navigation', { name: 'Navigation principale' }).boundingBox()
  expect(card!.y + card!.height).toBeLessThanOrEqual(tabs!.y)
})

// Enregistrement en échec (NAR-188) : l'erreur d'action survit à la relecture qui suit,
// distincte de l'erreur de chargement ; jamais les deux à la fois.
const TIANA = { ...FY, id: '6f1c2b1e-0000-4000-8000-000000000102', firstName: 'Tiana', avatarColor: 'green' }
const failures = [
  { name: '500', text: 'Une erreur est survenue. Réessayez.', fail: { status: 500, body: { error: 'Erreur interne.' } } },
  { name: 'réseau coupé', text: 'Connexion au serveur impossible. Vérifiez votre réseau et réessayez.', fail: 'network' },
  { name: '400 du serveur', text: 'Texte refusé par le serveur.', fail: { status: 400, body: { error: 'Texte refusé par le serveur.' } } }
] as const

// PUT du message 2 en échec tant que `state.failing` ; GET des textes comptés.
async function failingApi(page: import('@playwright/test').Page, fail: (typeof failures)[number]['fail'], extra: Parameters<typeof mockApi>[1] = {}) {
  const api = templatesApi()
  const state = { failing: true }
  const put = api.handlers[`PUT ${base}/2`]
  const calls = await mockApi(page, {
    ...api.handlers,
    [`PUT ${base}/2`]: (req) => (state.failing && fail !== 'network' ? fail : put(req)),
    ...extra
  })
  if (fail === 'network') {
    await page.route(`**${base}/2`, (route) => (state.failing ? route.abort('internetdisconnected') : route.fallback()))
  }
  const reads = () => calls.filter((r) => r.method() === 'GET' && new URL(r.url()).pathname === base).length
  return { api, state, reads }
}

for (const { name, text, fail } of failures) {
  test(`enregistrement en échec (${name}) : l’erreur du serveur reste après la relecture, un enregistrement réussi l’efface`, async ({ page }) => {
    const { api, state, reads } = await failingApi(page, fail)
    await openSection(page, 'Messages rapides')
    const card = page.locator('#messages-rapides')
    const field = page.getByLabel('Message 2')
    await expect(field).toBeEnabled()
    const before = reads()

    await field.fill('Viens me chercher à l’école')
    await page.getByRole('button', { name: 'Enregistrer les messages' }).click()
    // La carte a relu les textes, puis l'erreur est toujours là, seule.
    await expect.poll(reads).toBeGreaterThan(before)
    await expect(card.locator('form')).toHaveAttribute('aria-busy', 'false')
    await expect(field).toBeEnabled()
    await expect(card.getByRole('alert')).toHaveText(text)
    await expect(card.getByRole('alert')).toHaveCount(1)
    await expect(page.getByText('Enregistré. Le téléphone l’affichera')).toHaveCount(0)

    // Enregistrement suivant réussi : l'erreur disparaît.
    state.failing = false
    await field.fill('Viens me chercher à l’école')
    await page.getByRole('button', { name: 'Enregistrer les messages' }).click()
    await expect(page.getByText('Enregistré. Le téléphone l’affichera')).toBeVisible()
    await expect(card.getByRole('alert')).toHaveCount(0)
    expect(api.puts).toEqual([{ slot: 2, text: 'Viens me chercher à l’école' }])
  })
}

test('enregistrement en échec puis autre enfant : l’erreur est effacée', async ({ page }) => {
  await failingApi(page, failures[0].fail, { 'GET /api/children': () => ({ body: [FY, TIANA] }) })
  await openSection(page, 'Messages rapides')
  const card = page.locator('#messages-rapides')
  await page.getByLabel('Message 2').fill('Viens me chercher à l’école')
  await page.getByRole('button', { name: 'Enregistrer les messages' }).click()
  await expect(card.getByRole('alert')).toHaveText(failures[0].text)

  await page.getByRole('button', { name: /Enfant affiché : Fy/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Tiana/ }).click()
  await expect(page.getByRole('button', { name: /Enfant affiché : Tiana/ })).toBeVisible()
  await expect(page.getByLabel('Message 2')).toBeEnabled()
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('enregistrement en échec puis relecture en échec : une seule erreur à la fois', async ({ page }) => {
  let readFails = false
  const { state, reads } = await failingApi(page, failures[0].fail, {
    [`GET ${base}`]: () => (readFails ? { status: 500, body: { error: 'Erreur.' } } : { body: [1, 2, 3, 4].map((slot) => ({ slot, text: null })) })
  })
  await openSection(page, 'Messages rapides')
  const card = page.locator('#messages-rapides')
  await expect(page.getByLabel('Message 2')).toBeEnabled()
  const before = reads()
  readFails = true
  await page.getByLabel('Message 2').fill('Viens me chercher à l’école')
  await page.getByRole('button', { name: 'Enregistrer les messages' }).click()
  await expect.poll(reads).toBeGreaterThan(before)
  // Relecture en échec : le seul bloc de chargement (avec « Réessayer »), pas l'erreur d'enregistrement en plus.
  const loadAlert = card.getByRole('alert').filter({ hasText: 'Impossible de charger les messages rapides.' })
  await expect(loadAlert).toBeVisible()
  await expect(card.getByRole('alert')).toHaveCount(1)

  // Réessayer réussit : l'échec d'enregistrement, toujours vrai, revient seul.
  readFails = false
  state.failing = true
  await card.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByLabel('Message 2')).toBeEnabled()
  await expect(loadAlert).toHaveCount(0)
  await expect(card.getByRole('alert')).toHaveText(failures[0].text)
  await expect(card.getByRole('alert')).toHaveCount(1)
})
