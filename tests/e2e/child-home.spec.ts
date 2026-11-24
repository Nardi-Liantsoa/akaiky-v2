import { expect, test, type Page } from '@playwright/test'

// Écran de l'app enfant (NAR-187) sur le front construit, à 360×640. Le web est toujours
// « parent » (src/lib/appKind.ts) : le pont natif d'Android est simulé ici, avant le
// chargement de l'app (window.androidBridge + window.Capacitor.nativePromise), sans rien
// changer au code de production. API du téléphone simulée, réseau verrouillé.
// NAR187_SHOTS=<dossier> : captures d'écran écrites dans ce dossier.

const API = 'https://akaiky.a-definir.invalid/api'
const TAP_CHILD = 64
const SHOTS = process.env.NAR187_SHOTS

interface Scenario {
  kiosk: { deviceOwner: boolean, armed: boolean, locked: boolean, unlockedUntil?: number }
  screening: { available: boolean, held: boolean }
}

const CONTACTS = ['Maman', 'Papa', 'Mamie', 'Tonton'].map((name, i) => ({
  id: `c${i + 1}`, name, phone: `+26134000000${i + 1}`, position: i + 1,
  avatarColor: ['#e9814a', '#3d80d1', '#7b5ccc', '#0b795c'][i], parent: true
}))

// Plage « école » en cours (fuseau UTC) : commencée il y a une heure, finie dans deux.
function schoolNow() {
  const d = new Date()
  const min = d.getUTCHours() * 60 + d.getUTCMinutes()
  return [{ label: 'École', days: 127, startMin: (min + 1380) % 1440, endMin: (min + 120) % 1440 }]
}

async function openChild(page: Page, scenario: Scenario, opts: { school?: boolean, offline?: boolean, locate?: boolean } = {}) {
  const positions: unknown[] = []
  await page.addInitScript((s: Scenario) => {
    const store: Record<string, string> = {
      'capacitor-storage_device-refresh-token': JSON.stringify('rt-test'),
      'capacitor-storage_parent-code': JSON.stringify('pbkdf2-sha256$1000$c2Vs$a2V5'),
      'capacitor-storage_device-country': JSON.stringify('MG')
    }
    // Méthodes natives de SecureStorage seulement (le reste est sa couche JS).
    const secure = ['setSynchronizeKeychain', 'internalGetItem', 'internalSetItem', 'internalRemoveItem', 'internalClearItemsWithPrefix', 'internalGetPrefixedKeys']
    const all = { find: () => ({ name: '*', rtype: 'promise' }) }
    const plugins = ['App', 'StatusBar', 'CapacitorUpdater', 'SecureStorage', 'AkaikyKiosk', 'AkaikyCall', 'AkaikyDevice', 'AkaikySos', 'AkaikyUpdate', 'AkaikyBackground', 'AkaikyLocation']
    const headers = plugins.map((name) => ({ name, methods: name === 'SecureStorage' ? secure.map((m) => ({ name: m, rtype: 'promise' })) : all }))
    const w = window as unknown as Record<string, unknown>
    w.androidBridge = { postMessage() {} }
    w.Capacitor = {
      PluginHeaders: headers,
      nativeCallback: () => 'cb',
      nativePromise: async (plugin: string, method: string, o: Record<string, string> = {}) => {
        const key = `${plugin}.${method}`
        if (method === 'addListener') return 'cb'
        switch (key) {
          case 'App.getInfo': return { id: 'mg.nosytech.akaiky.enfant', name: 'Akaiky Enfant', build: '1', version: '1.0.0' }
          case 'App.getState': return { isActive: true }
          case 'SecureStorage.internalGetItem': return { data: store[o.prefixedKey] ?? null }
          case 'SecureStorage.internalSetItem': store[o.prefixedKey] = o.data; return {}
          case 'SecureStorage.internalRemoveItem': delete store[o.prefixedKey]; return { success: true }
          case 'SecureStorage.internalGetPrefixedKeys': return { keys: [] }
          case 'AkaikyKiosk.listLaunchableApps': return { apps: [] }
          case 'AkaikyKiosk.applyAllowedApps': return { deviceOwner: true, armed: s.kiosk.armed, allowed: [], hidden: 0 }
          case 'AkaikyKiosk.bringToFront': return { brought: false }
          case 'AkaikyCall.screeningRole': return s.screening
          case 'AkaikyCall.peekIncoming': return { events: [] }
          case 'AkaikyCall.lastOutgoing': return { found: false }
          // Appel refusé : l'erreur d'appel s'affiche sur l'accueil.
          case 'AkaikyCall.call': throw new Error('call refused')
          case 'AkaikyDevice.getStatus': return { battery: 80, charging: false, network: 'wifi', simState: 'ready' }
          case 'AkaikyDevice.getProvisioning': return {}
          case 'AkaikyDevice.getInfo': return { deviceOwner: true, model: 'test', osVersion: '14', appVersion: '1.0.0' }
          case 'AkaikySos.state': return { active: false }
          case 'AkaikyLocation.currentPosition': return { lat: -18.9, lng: 47.5, accuracyM: 12, ageS: 1 }
        }
        if (plugin === 'AkaikyKiosk') return s.kiosk
        return {}
      }
    }
  }, scenario)
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://127.0.0.1:4173') return route.fallback()
    if (!url.href.startsWith(API)) return route.abort('blockedbyclient')
    const path = url.pathname.replace(/^\/api/, '')
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
    if (path === '/device/refresh') return json({ accessToken: 'at-test', refreshToken: 'rt-test' })
    if (opts.offline) return json({ error: 'indisponible' }, 503)
    if (path === '/device/me') return json({ device: { id: 'd1' }, child: { id: 'k1', firstName: 'Fy' } })
    if (path === '/device/config') {
      return json({
        version: 1, country: 'MG', parentCode: 'pbkdf2-sha256$1000$c2Vs$a2V5', timezone: 'UTC',
        schedules: opts.school ? schoolNow() : [], allowedApps: [], contacts: CONTACTS
      }, 200, { ETag: '"v1"' })
    }
    if (path === '/device/messages' && route.request().method() === 'GET') return json([])
    // Position à la demande (NAR-204) : Papa regarde, un relevé est dû jusqu'au premier envoi.
    if (path === '/device/locate') {
      if (!opts.locate) return json({ pending: false, watchers: [], watchingUntil: null })
      return json({ pending: positions.length === 0, watchers: [{ name: 'Papa' }], watchingUntil: new Date(Date.now() + 120_000).toISOString() })
    }
    if (path === '/device/positions') { positions.push(route.request().postDataJSON()); return json({ ok: true }) }
    return json({})
  })
  await page.goto('/')
  await page.waitForURL('**/enfant')
  return positions
}

// Hauteur rendue de chaque cible tactile visible.
async function heights(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10))
}

async function expectSosVisible(page: Page) {
  const vh = page.viewportSize()!.height
  // La page elle-même ne défile pas : seul le contenu, au-dessus du pied.
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true)
  for (const sel of ['.actions .sos', '.actions .emergency']) {
    const box = (await page.locator(sel).boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(vh)
  }
  // Le pied ne cache aucune vignette : chacune, amenée à l'écran, finit au-dessus de lui.
  const footerTop = (await page.locator('.actions').boundingBox())!.y
  const tiles = page.locator('.grid .tile')
  for (let i = 0; i < await tiles.count(); i++) {
    await tiles.nth(i).scrollIntoViewIfNeeded()
    const box = (await tiles.nth(i).boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(footerTop + 0.5)
  }
  await page.locator('.content').evaluate((e) => { e.scrollTop = 0 })
}

test.use({ viewport: { width: 360, height: 640 } })
test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'écran Android seulement')
})

test('accueil déverrouillé : bandeaux, erreur d’appel, 4 contacts, SOS visible, cibles ≥ 64 px', async ({ page }) => {
  await openChild(page, {
    kiosk: { deviceOwner: true, armed: true, locked: false, unlockedUntil: Date.now() + 10 * 60_000 },
    screening: { available: true, held: false }
  })
  await expect(page.locator('.grid .tile')).toHaveCount(4)
  await page.locator('.grid .tile').first().click()
  await expect(page.locator('.call-error')).toBeVisible()
  await expect(page.locator('.unlocked-actions .btn')).toHaveCount(2)
  await expect(page.locator('.unlocked > .btn')).toHaveCount(1)
  await expectSosVisible(page)
  for (const sel of ['.unlocked-actions .btn', '.unlocked > .btn', '.actions .emergency', '.actions .sos']) {
    for (const h of await heights(page, sel)) expect(h, sel).toBeGreaterThanOrEqual(TAP_CHILD)
  }
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/1-deverrouille-haut.png` })
    // Contenu défilé jusqu'à l'erreur d'appel : erreur, vignettes et SOS à l'écran ensemble.
    await page.locator('.content').evaluate((e) => { e.scrollTop = (e.querySelector('.call-error') as HTMLElement).offsetTop - 8 })
    await page.screenshot({ path: `${SHOTS}/1b-deverrouille-erreur-4-contacts.png` })
  }

  // SOS : anneau de focus clavier visible.
  await page.locator('.actions .sos').focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const outline = await page.locator('.actions .sos').evaluate((e) => getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth)
  expect(outline).toBe('solid 3px')

  // Messages rapides : Fermer ≥ 64 px.
  await page.locator('.apps .messages').click()
  await expect(page.locator('.quick')).toBeVisible()
  for (const h of await heights(page, '.quick .close, .quick .tile')) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
})

test('plage « école », verrouillé : bandeau, erreur d’appel, 4 parents, SOS et code parent visibles', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } }, { school: true })
  await expect(page.locator('.school-banner')).toBeVisible()
  await expect(page.locator('.grid .tile')).toHaveCount(4)
  await page.locator('.grid .tile').nth(1).click()
  await expect(page.locator('.call-error')).toBeVisible()
  await expectSosVisible(page)
  const vh = page.viewportSize()!.height
  const code = (await page.locator('.actions .parent-code').boundingBox())!
  expect(code.y + code.height).toBeLessThanOrEqual(vh)
  for (const sel of ['.actions .parent-code', '.actions .emergency', '.actions .sos']) {
    for (const h of await heights(page, sel)) expect(h, sel).toBeGreaterThanOrEqual(TAP_CHILD)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-ecole-verrouille-erreur-4-contacts.png` })

  // Clavier du code parent : touches et Fermer ≥ 64 px.
  await page.locator('.actions .parent-code').click()
  await expect(page.locator('.unlock')).toBeVisible()
  const keys = await heights(page, '.unlock .key')
  expect(keys).toHaveLength(12)
  for (const h of keys) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
  const widths = await page.locator('.unlock .key').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  for (const w of widths) expect(w).toBeGreaterThanOrEqual(TAP_CHILD)
})

test('écran d’erreur verrouillé : réessayer, secours, rendre et reverrouiller ≥ 64 px', async ({ page }) => {
  await openChild(page, {
    kiosk: { deviceOwner: true, armed: true, locked: false, unlockedUntil: Date.now() + 10 * 60_000 },
    screening: { available: true, held: true }
  }, { offline: true })
  await expect(page.locator('main.child .retry')).toBeVisible()
  await expect(page.locator('main.child .btn')).toHaveCount(3)
  for (const sel of ['main.child .btn', 'main.child .emergency']) {
    for (const h of await heights(page, sel)) expect(h, sel).toBeGreaterThanOrEqual(TAP_CHILD)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-erreur-verrouille.png` })
})

test('écran d’erreur verrouillé : code parent ≥ 64 px', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } }, { offline: true })
  await expect(page.locator('main.child .parent-code')).toBeVisible()
  for (const sel of ['main.child .parent-code', 'main.child .emergency', 'main.child .retry']) {
    for (const h of await heights(page, sel)) expect(h, sel).toBeGreaterThanOrEqual(TAP_CHILD)
  }
})

// Écran couché ou très court (l'orientation n'est pas bloquée) : le pied le plus haut
// (SOS, secours, code parent) tient encore, le contenu défile au-dessus.
test.describe('écran couché 640×360', () => {
  test.use({ viewport: { width: 640, height: 360 } })
  test('verrouillé : SOS, secours et code parent à l’écran, vignettes au-dessus du pied', async ({ page }) => {
    await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } })
    await expect(page.locator('.grid .tile')).toHaveCount(4)
    await expect(page.locator('.actions .parent-code')).toBeVisible()
    await expectSosVisible(page)
    const code = (await page.locator('.actions .parent-code').boundingBox())!
    expect(code.y + code.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  })
})

test('un parent regarde : « Papa regarde où tu es », un relevé unique envoyé, SOS toujours visible', async ({ page }) => {
  const positions = await openChild(page, {
    kiosk: { deviceOwner: true, armed: true, locked: true },
    screening: { available: true, held: true }
  }, { locate: true })
  await expect(page.getByRole('status').filter({ hasText: 'Papa regarde où tu es' })).toBeVisible()
  await expect.poll(() => positions.length).toBe(1)
  expect(positions[0]).toEqual({ lat: -18.9, lng: 47.5, accuracyM: 12, ageS: 1 })
  await expectSosVisible(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/enfant-regarde.png` })
})

test('personne ne regarde : aucun indicateur, aucun relevé', async ({ page }) => {
  const positions = await openChild(page, {
    kiosk: { deviceOwner: true, armed: true, locked: true },
    screening: { available: true, held: true }
  })
  await expect(page.locator('.grid .tile')).toHaveCount(4)
  await expect(page.getByText('regarde où tu es')).toHaveCount(0)
  expect(positions).toEqual([])
})
