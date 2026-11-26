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
  // Applications lançables et autorisées (rangée d'icônes, NAR-238).
  apps?: { package: string, label: string }[]
  // État du service SOS une fois lancé (NAR-239) ; avant le lancement : aucun SOS.
  sos?: Record<string, unknown>
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

async function openChild(page: Page, scenario: Scenario, opts: { school?: boolean, offline?: boolean, locate?: boolean, contacts?: typeof CONTACTS } = {}) {
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
          case 'AkaikyKiosk.listLaunchableApps': return { apps: (s.apps ?? []).map((a) => ({ ...a, icon: null })) }
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
          case 'AkaikySos.start': {
            ;(window as unknown as { sosStarts: number }).sosStarts = ((window as unknown as { sosStarts?: number }).sosStarts ?? 0) + 1
            return s.sos ? { started: true, runId: 'r1', state: s.sos } : { started: false }
          }
          case 'AkaikySos.cancel': {
            ;(window as unknown as { sosCancels: number }).sosCancels = ((window as unknown as { sosCancels?: number }).sosCancels ?? 0) + 1
            return {}
          }
          case 'AkaikySos.state': return (window as unknown as { sosStarts?: number }).sosStarts && s.sos ? s.sos : { active: false }
          case 'AkaikyLocation.currentPosition': return { lat: -18.9, lng: 47.5, accuracyM: 12, ageS: 1 }
          case 'AkaikyLocation.cancel': return {}
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
        schedules: opts.school ? schoolNow() : [], contacts: opts.contacts ?? CONTACTS,
        allowedApps: (scenario.apps ?? []).map((a, i) => ({ ...a, position: i + 1 }))
      }, 200, { ETag: '"v1"' })
    }
    if (path === '/device/messages' && route.request().method() === 'GET') return json([])
    // Position à la demande (NAR-204) : Papa regarde, un relevé est dû jusqu'au premier envoi.
    if (path === '/device/locate') {
      if (!opts.locate) return json({ pending: false, watchers: [], watchingUntil: null, watchingForMs: 0 })
      return json({ pending: positions.length === 0, watchers: [{ name: 'Papa' }], watchingUntil: new Date(Date.now() + 120_000).toISOString(), watchingForMs: 120_000 })
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
  const box = (await page.locator('.actions .sos').boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(vh)
  // Maquette allégée (NAR-237) : plus de 117 sur l'accueil (secours dans l'écran du SOS).
  await expect(page.locator('.home .emergency')).toHaveCount(0)
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
  // Mode parent (planche 05, NAR-238) : barre verte, engrenage et « Reverrouiller » ; pas de cadenas.
  await expect(page.locator('.parent-bar')).toContainText('Mode parent')
  await expect(page.locator('.parent-bar button')).toHaveCount(2)
  await expect(page.locator('.status .parent-code')).toHaveCount(0)
  // Filtrage inactif : pastille d'une ligne, et en mode parent le détail avec « Activer ».
  await expect(page.locator('.chip-warn')).toHaveText('Appels pas encore filtrés')
  await expect(page.locator('.unlocked > .btn')).toHaveCount(1)
  await expectSosVisible(page)
  for (const sel of ['.parent-bar button', '.unlocked > .btn', '.actions .sos', '.say']) {
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

  // Messages rapides par « Dire à mes parents » (NAR-237) : Fermer ≥ 64 px.
  await page.getByRole('button', { name: 'Dire à mes parents' }).click()
  await expect(page.locator('.quick')).toBeVisible()
  for (const h of await heights(page, '.quick .back, .quick .tile')) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
})

test('plage « école », verrouillé : bandeau, erreur d’appel, 4 parents, SOS et cadenas visibles', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } }, { school: true })
  // Pastille d'une ligne (planche 04, NAR-238) au lieu du bandeau.
  await expect(page.locator('.chip-school')).toHaveText(/^École jusqu’à \d\d:\d\d$/)
  await expect(page.locator('.ghosts')).toHaveCount(0)
  await expect(page.locator('.grid .tile')).toHaveCount(4)
  await page.locator('.grid .tile').nth(1).click()
  await expect(page.locator('.call-error')).toBeVisible()
  await expectSosVisible(page)
  const vh = page.viewportSize()!.height
  const code = (await page.locator('.status .parent-code').boundingBox())!
  expect(code.y + code.height).toBeLessThanOrEqual(vh)
  // En-tête collant (NAR-237) : contenu défilé jusqu'en bas, le cadenas reste à l'écran.
  await page.locator('.content').evaluate((e) => { e.scrollTop = e.scrollHeight })
  await expect(page.locator('.status .parent-code')).toBeInViewport({ ratio: 1 })
  await page.locator('.content').evaluate((e) => { e.scrollTop = 0 })
  for (const sel of ['.status .parent-code', '.actions .sos']) {
    for (const h of await heights(page, sel)) expect(h, sel).toBeGreaterThanOrEqual(TAP_CHILD)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-ecole-verrouille-erreur-4-contacts.png` })

  // Clavier du code parent (planche 08, NAR-240) : 11 touches (chiffres et effacer), flèche de
  // retour hors du pavé, toutes ≥ 64 px.
  await page.getByRole('button', { name: 'Code parent' }).click()
  await expect(page.locator('.unlock')).toBeVisible()
  const keys = await heights(page, '.unlock .key, .unlock .back')
  expect(keys).toHaveLength(12)
  for (const h of keys) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
  const widths = await page.locator('.unlock .key, .unlock .back').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  for (const w of widths) expect(w).toBeGreaterThanOrEqual(TAP_CHILD)
})

test('écran d’erreur verrouillé : réessayer, secours, rendre et reverrouiller ≥ 64 px', async ({ page }) => {
  await openChild(page, {
    kiosk: { deviceOwner: true, armed: true, locked: false, unlockedUntil: Date.now() + 10 * 60_000 },
    screening: { available: true, held: true }
  }, { offline: true })
  await expect(page.locator('main.child .retry')).toBeVisible()
  // Planche 09 (NAR-241) : actions des parents dans une carte ; une seule action principale.
  const card = page.locator('.parent-card')
  await expect(card.locator('.parent-pill')).toHaveText(/^Mode parent · jusqu’à \d\d:\d\d$/)
  await expect(card.locator('.btn')).toHaveText('Libérer ce téléphone')
  await expect(card).toContainText('Supprime tous les verrous Akaiky.')
  await expect(card.getByRole('button', { name: 'Reverrouiller maintenant' })).toHaveClass(/relock-link/)
  await expect(page.locator('main.child .emergency')).toHaveText('Appeler les secours · 117')
  // Secours sous la carte, en bas de l'écran.
  const cardBox = (await card.boundingBox())!
  expect((await page.locator('main.child .emergency').boundingBox())!.y).toBeGreaterThan(cardBox.y + cardBox.height)
  for (const sel of ['main.child .btn', 'main.child .emergency', '.relock-link']) {
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
  test('verrouillé : SOS et code parent à l’écran, vignettes au-dessus du pied', async ({ page }) => {
    await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } })
    await expect(page.locator('.grid .tile')).toHaveCount(4)
    await expect(page.locator('.status .parent-code')).toBeVisible()
    await expectSosVisible(page)
    const code = (await page.locator('.status .parent-code').boundingBox())!
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
  const asked = page.waitForResponse((r) => r.url().endsWith('/api/device/locate'))
  const positions = await openChild(page, {
    kiosk: { deviceOwner: true, armed: true, locked: true },
    screening: { available: true, held: true }
  })
  await asked
  await expect(page.locator('.grid .tile')).toHaveCount(4)
  await expect(page.getByText('regarde où tu es')).toHaveCount(0)
  expect(positions).toEqual([])
})

// NAR-238, planche 04 : un seul parent pendant la plage, en grande tuile ; les autres en fantôme.
test('plage « école » : un parent en tuile large, les autres en fantôme avec l’heure de retour', async ({ page }) => {
  const one = CONTACTS.map((c, i) => ({ ...c, parent: i === 0 }))
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } }, { school: true, contacts: one })
  await expect(page.locator('.grid .tile')).toHaveCount(1)
  await expect(page.locator('.grid .tile.wide')).toContainText('Maman')
  await expect(page.locator('.ghosts')).toHaveText(/^PMTPapa, Mamie et Tonton reviennent à \d\d:\d\d$/)
  await expect(page.locator('.ghosts button')).toHaveCount(0)
  await expectSosVisible(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ecole-fantomes.png` })
})

// NAR-238, planche 02 : sans contacts, état vide illustré ; filtrage en pastille, sans bouton (verrouillé).
test('sans contacts, verrouillé : état vide illustré, pastille du filtrage sans bouton', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: false } }, { contacts: [] })
  await expect(page.getByText('Ta famille arrive bientôt')).toBeVisible()
  await expect(page.locator('.chip-warn')).toHaveText('Appels pas encore filtrés')
  await expect(page.getByRole('button', { name: 'Activer le filtrage des appels' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dire à mes parents' })).toBeVisible()
  await expectSosVisible(page)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sans-contacts.png` })
})

// NAR-238, planche 03 : 4 applications, 3 icônes et « Plus » qui montre la dernière.
test('4 applications : trois icônes et « Plus », qui montre la quatrième', async ({ page }) => {
  const apps = [['clock', 'Horloge'], ['agenda', 'Agenda'], ['photo', 'Photo'], ['calc', 'Calculatrice']].map(([p, l]) => ({ package: `com.test.${p}`, label: l }))
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true }, apps }, { locate: true })
  const row = page.getByRole('navigation', { name: 'Mes applications' })
  await expect(row.locator('.name')).toHaveText(['Horloge', 'Agenda', 'Photo', 'Plus'])
  for (const h of await heights(page, '.apps .app')) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/applis.png` })
  await row.getByRole('button', { name: 'Voir les autres applications' }).click()
  await expect(row.locator('.name')).toHaveText(['Horloge', 'Agenda', 'Photo', 'Calculatrice'])
  await expect(row.getByRole('button', { name: 'Ouvrir Calculatrice' })).toBeFocused()
})

// NAR-239, planche 10 : pendant l'appui, voile, compte à rebours et anneau ; lâcher avant 3 s annule.
async function holdSos(page: Page, ms: number) {
  const box = (await page.locator('.actions .sos').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
}
const CALLS = ['Maman', 'Papa', 'Mamie', 'Tonton']
const SMS = CALLS.map((name, i) => ({ id: `c${i + 1}`, name, status: 'sent' }))

test('SOS, appui de 1 s puis lâché : voile, « 2 », « 1 s sur 3 », anneau ; rien n’est lancé', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } })
  await holdSos(page, 1200)
  const veil = page.locator('.sos-veil')
  await expect(veil).toBeVisible()
  await expect(veil.locator('.count')).toHaveText('2')
  await expect(veil).toContainText('Continue d’appuyer…')
  await expect(veil).toContainText('Lâche le doigt pour annuler.')
  await expect(page.locator('.sos-dock .hint')).toHaveText('1 s sur 3')
  await expect(page.locator('.ring')).toBeVisible()
  // Le bouton reste au-dessus du voile (empilement), visible sous le doigt.
  const top = await page.evaluate(() => {
    const b = document.querySelector('.actions .sos')!.getBoundingClientRect()
    return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.sos') !== null
  })
  expect(top).toBe(true)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sos-appui.png` })
  await page.mouse.up()
  await expect(veil).toHaveCount(0)
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => (window as unknown as { sosStarts?: number }).sosStarts ?? 0)).toBe(0)
  await expect(page.locator('.sos-sent')).toHaveCount(0)
})

test('SOS en cours (planche 11) : étapes faite, en cours, à venir ; secours et « Annuler l’alerte »', async ({ page }) => {
  const sos = { active: true, status: 'calling', runId: 'r1', index: 0, calls: CALLS, sms: SMS, positionKnown: true }
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true }, sos })
  await holdSos(page, 3300)
  await page.mouse.up()
  const view = page.getByRole('dialog', { name: 'On prévient ta famille' })
  await expect(view).toBeVisible()
  await expect(view).toContainText('Alerte en cours')
  await expect(view.locator('.step').nth(0)).toHaveText(/Message envoyé\s*avec ta position/)
  await expect(view.locator('.step').nth(1)).toContainText('Appel de Maman…')
  await expect(view.locator('.step').nth(2)).toHaveText(/Ensuite : Papa, Mamie, Tonton\s*si Maman ne répond pas/)
  await expect(view.getByRole('button', { name: 'Appeler les secours · 117' })).toBeVisible()
  await expect(view.getByRole('button', { name: 'Annuler l’alerte' })).toBeVisible()
  for (const h of await heights(page, '.sos-sent button')) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sos-en-cours.png` })
})

test('alerte envoyée, personne n’a répondu (planche 12) : coches, carte blanche avec le 117, « Fermer »', async ({ page }) => {
  const sos = { active: true, status: 'emergency', runId: 'r1', index: CALLS.length, calls: CALLS, sms: SMS, positionKnown: true }
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true }, sos })
  await holdSos(page, 3300)
  await page.mouse.up()
  const view = page.getByRole('dialog', { name: 'Alerte envoyée' })
  await expect(view).toBeVisible()
  await expect(view.locator('.oks li')).toHaveText(['SMS envoyé à ta famille', 'Ta position est dans le SMS'])
  await expect(view.locator('.no-answer')).toContainText('Personne n’a répondu')
  await expect(view.locator('.no-answer')).toContainText('Si tu es en danger, appelle les secours.')
  await expect(view.getByRole('button', { name: 'Appeler le 117' })).toBeVisible()
  await expect(view.getByRole('button', { name: 'Fermer' })).toBeVisible()
  for (const h of await heights(page, '.sos-sent button')) expect(h).toBeGreaterThanOrEqual(TAP_CHILD)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/alerte-envoyee.png` })
  // « Fermer » cache l'écran sans annuler le SOS (sirène gardée sur le composeur des secours).
  await view.getByRole('button', { name: 'Fermer' }).click()
  await expect(view).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { sosCancels?: number }).sosCancels ?? 0)).toBe(0)
})

// NAR-240, planche 08 : code faux, points rouges et message juste dessous ; retour (Échap, comme
// le retour d'Android par la pile des feuilles) ferme le clavier.
test('code parent faux : points rouges, « Code incorrect, réessaie. » sous les points ; retour ferme', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } })
  await page.getByRole('button', { name: 'Code parent' }).click()
  const pad = page.getByRole('dialog', { name: 'Code parent' })
  for (const d of '123456') await pad.getByRole('button', { name: d, exact: true }).click()
  await expect(pad.locator('.message')).toHaveText('Code incorrect, réessaie.')
  await expect(pad.locator('.dots.bad span')).toHaveCount(6)
  const dots = (await pad.locator('.dots').boundingBox())!
  const msg = (await pad.locator('.message').boundingBox())!
  expect(msg.y - (dots.y + dots.height)).toBeLessThan(24)
  // Place réservée sous les points : un message long ne fait jamais bouger le pavé.
  await expect(pad.locator('.message')).toHaveCSS('min-height', '72px')
  await expect(pad.getByRole('button', { name: 'Fermer' })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/code-faux.png` })
  await page.keyboard.press('Escape')
  await expect(pad).toHaveCount(0)
})

// NAR-240, planche 07 : aide qui nomme les parents, tuile envoyée cochée, confirmation en bas.
test('dire à mes parents : aide, tuile envoyée cochée, confirmation en bas ; flèche de retour', async ({ page }) => {
  await openChild(page, { kiosk: { deviceOwner: true, armed: true, locked: true }, screening: { available: true, held: true } })
  await page.getByRole('button', { name: 'Dire à mes parents' }).click()
  const panel = page.getByRole('dialog', { name: 'Dire à mes parents' })
  await expect(panel.locator('.quick-help')).toHaveText('Touche un message, ta famille le reçoit.')
  await panel.getByRole('button', { name: 'Je suis arrivé' }).click()
  await expect(panel.locator('.tile.sent')).toHaveCount(1)
  await expect(panel.locator('.tile.sent .check')).toBeVisible()
  await expect(panel.locator('.toast')).toHaveText('« Je suis arrivé » envoyé à ta famille')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dire-parents.png` })
  await panel.getByRole('button', { name: 'Fermer' }).click()
  await expect(panel).toHaveCount(0)
})
