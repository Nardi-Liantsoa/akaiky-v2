import { expect, test } from '@playwright/test'
import { FAMILY, mockApi, USER } from './mock'

const connected = { 'GET /api/auth/me': () => ({ body: { user: USER } }), 'GET /api/families/me': () => ({ body: FAMILY }) }

test('parent connecté : quatre onglets, sans rechargement, onglet actif signalé', async ({ page }) => {
  await mockApi(page, connected)
  await page.goto('/espace')
  const tabs = page.getByRole('navigation', { name: 'Navigation principale' })
  await expect(page.getByRole('heading', { name: 'Accueil' })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page')

  // Un marqueur posé sur window survit seulement si la page n'est pas rechargée.
  await page.evaluate(() => { (window as unknown as { marker: number }).marker = 1 })
  for (const [name, path] of [['Journal', '/espace/journal'], ['Réglages', '/espace/reglages'], ['Famille', '/espace/famille'], ['Accueil', '/espace']]) {
    await tabs.getByRole('link', { name }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(tabs.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1)
  }
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1)
})

test('police servie par l’application, aucun appel à un tiers', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const thirdParty: string[] = []
  const fonts: { url: string, status: number }[] = []
  // « request » voit aussi les appels tiers, que mockApi coupe avant toute réponse.
  page.on('request', (r) => { if (new URL(r.url()).origin !== origin) thirdParty.push(r.url()) })
  page.on('response', (r) => { if (r.request().resourceType() === 'font') fonts.push({ url: r.url(), status: r.status() }) })
  await mockApi(page, connected)
  await page.goto('/espace')
  // La police se charge quand du texte en a besoin : attendre le rendu, puis le chargement.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  // check() répond vrai même pour une police en échec : on lit son état réel.
  const status = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Nunito').map((f) => f.status))
  expect(status).toEqual(['loaded'])
  expect(thirdParty).toEqual([])
  expect(fonts.length).toBeGreaterThan(0)
  for (const f of fonts) expect(f.status).toBe(200)
})

test('police préchargée depuis le HTML et téléchargée une seule fois (NAR-157)', async ({ page, request }) => {
  const html = await (await request.get('/')).text()
  const preloads = [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((m) => m[0]).filter((tag) => /\bas="font"/.test(tag))
  expect(preloads).toHaveLength(1)
  // Sans crossorigin, le preload ne sert pas à @font-face et la police part deux fois.
  expect(preloads[0]).toMatch(/\bcrossorigin\b/)
  expect(preloads[0]).toMatch(/\btype="font\/woff2"/)
  const href = preloads[0].match(/\bhref="([^"]+)"/)?.[1]
  expect(href).toMatch(/^\/assets\/[^/]+\.woff2$/)
  expect((await request.get(href!)).status()).toBe(200)

  const fonts: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('.woff2')) fonts.push(new URL(r.url()).pathname) })
  await mockApi(page, connected)
  await page.goto('/espace')
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const status = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Nunito').map((f) => f.status))
  expect(status).toEqual(['loaded'])
  expect(fonts).toEqual([href])
})

test('écran étroit en malgache : libellés des onglets contenus dans leur colonne', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.addInitScript(() => { try { localStorage.setItem('akaiky-v2.lang', 'mg') } catch { /* stockage indisponible */ } })
  await mockApi(page, connected)
  await page.goto('/espace')
  const tabs = page.getByRole('navigation', { name: 'Fitetezana lehibe' }).getByRole('link')
  await expect(tabs).toHaveCount(4)
  const overflow = await tabs.evaluateAll((links) => links.some((a) => a.scrollWidth > a.clientWidth))
  expect(overflow).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('app parent (web) : l’écran de l’app enfant n’est pas atteignable', async ({ page }) => {
  await mockApi(page, { 'GET /api/auth/me': () => ({ body: { user: null } }), 'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }) })
  await page.goto('/enfant')
  await expect(page).toHaveURL(/\/$/)
})

// NAR-156 : une seule navigation pour le parent connecté, la barre d'onglets.
test('parent connecté : pas d’en-tête global, compte, langue et sécurité depuis Famille', async ({ page }) => {
  await mockApi(page, {
    ...connected,
    'GET /api/auth/security': () => ({ body: { devices: [], mfaEnabled: false, recoveryCodesRemaining: 0 } }),
    'GET /api/auth/app-sessions': () => ({ body: [] })
  })
  await page.goto('/espace/famille')
  const tabs = page.getByRole('navigation', { name: 'Navigation principale' })
  await expect(page.getByRole('heading', { name: 'Famille', exact: true })).toBeVisible()
  await expect(page.getByRole('banner')).toHaveCount(0)
  const account = page.getByRole('region', { name: 'Mon compte' })
  // Administration réservée aux administrateurs.
  await expect(account.getByRole('link', { name: 'Administration' })).toHaveCount(0)

  // Langue : toute l'interface suit, la barre d'onglets comprise.
  await account.getByLabel('Langue').selectOption('en')
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await page.getByRole('region', { name: 'My account' }).getByLabel('Language').selectOption('fr')

  await account.getByRole('link', { name: 'Sécurité' }).click()
  await expect(page).toHaveURL(/\/espace\/compte\/securite$/)
  await expect(page.getByRole('heading', { name: 'Sécurité du compte', level: 1 })).toBeVisible()
  await expect(page.getByRole('banner')).toHaveCount(0)
  await expect(tabs.getByRole('link', { name: 'Famille' })).toHaveAttribute('aria-current', 'page')
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1)

  // Ancienne adresse : même écran, dans la coquille.
  await page.goto('/securite')
  await expect(page).toHaveURL(/\/espace\/compte\/securite$/)
  await expect(tabs.getByRole('link', { name: 'Famille' })).toHaveAttribute('aria-current', 'page')
})

test('déconnexion depuis Famille : retour à l’accueil public, avec son en-tête', async ({ page }) => {
  let user: typeof USER | null = USER
  const calls = await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user } }),
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/families/me': () => ({ body: FAMILY }),
    'POST /api/auth/logout': () => { user = null; return { body: { ok: true } } }
  })
  await page.goto('/espace/famille')
  await page.getByRole('region', { name: 'Mon compte' }).getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(calls.some((r) => r.method() === 'POST' && r.url().endsWith('/api/auth/logout'))).toBe(true)
  // Visiteur : l'en-tête global revient, sans les liens du compte.
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: 'Connexion' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Déconnexion' })).toHaveCount(0)
})

test('administrateur parent : Administration dans « Mon compte », en-tête sur le back-office', async ({ page }) => {
  const admin = { ...USER, is_admin: true }
  await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user: admin } }),
    'GET /api/families/me': () => ({ body: FAMILY }),
    'GET /api/admin/users': () => ({ body: [] }),
    'GET /api/admin/audit': () => ({ body: [] })
  })
  await page.goto('/espace/famille')
  await page.getByRole('region', { name: 'Mon compte' }).getByRole('link', { name: 'Administration' }).click()
  await expect(page).toHaveURL(/\/admin$/)
  const header = page.getByRole('banner')
  await expect(header.getByRole('link', { name: 'Sécurité' })).toBeVisible()
  await expect(header.getByRole('link', { name: 'Administration' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Déconnexion' })).toBeVisible()
  await expect(header.getByRole('link', { name: 'Mon espace' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0)
})

test('parent sans famille : « Mon compte » sur l’écran de création, sans en-tête', async ({ page }) => {
  await mockApi(page, {
    'GET /api/auth/me': () => ({ body: { user: USER } }),
    'GET /api/families/me': () => ({ status: 404, body: { error: 'Famille introuvable.', code: 'no_family' } })
  })
  await page.goto('/espace')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Akaiky' })).toBeVisible()
  await expect(page.getByRole('banner')).toHaveCount(0)
  const account = page.getByRole('region', { name: 'Mon compte' })
  await expect(account.getByRole('link', { name: 'Sécurité' })).toBeVisible()
  await expect(account.getByRole('button', { name: 'Déconnexion' })).toBeVisible()
})

// NAR-192 : cibles tactiles de la carte d'un enfant, « ⋯ » en icône nommée.
test('accueil : « Tout le journal », « ⋯ » et l’en-tête de la carte font au moins 48 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  const FY = '6f1c2b1e-0000-4000-8000-000000000101'
  await mockApi(page, {
    ...connected,
    'GET /api/auth/mfa/status': () => ({ body: { challenge: null } }),
    'GET /api/children': () => ({ body: [{ id: FY, firstName: 'Fy', avatarColor: 'orange', createdAt: '2026-11-11T10:00:00Z', parentCodeSetAt: null, remoteUnlockUntil: null, phoneLastSeenAt: new Date().toISOString() }] }),
    [`GET /api/children/${FY}/journal`]: () => ({ body: { items: [], next: null } })
  })
  await page.goto('/espace')
  const more = page.getByRole('button', { name: 'Actions pour Fy' })
  await expect(more).toBeVisible()
  // Icône du jeu commun, sans texte « ⋯ » ; le nom vient d'aria-label.
  await expect(more.locator('svg')).toHaveCount(1)
  await expect(more).toHaveText('')
  for (const target of [page.getByRole('link', { name: 'Tout le journal' }), more, page.getByRole('button', { name: /^Fy / })]) {
    const box = await target.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(48)
    expect(box?.width).toBeGreaterThanOrEqual(48)
  }
})
