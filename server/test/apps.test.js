// Applications autorisées (NAR-143) : inventaire envoyé par le téléphone, liste choisie par
// owner/manager, reçue par le téléphone dans sa configuration, export.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const CAMERA = { package: 'com.android.camera2', label: 'Appareil photo', icon: PNG }
const CALC = { package: 'com.android.calculator2', label: 'Calculatrice', icon: null }
const CLOCK = { package: 'com.android.deskclock', label: 'Horloge' }
const GALLERY = { package: 'com.android.gallery3d', label: 'Galerie' }
const MUSIC = { package: 'com.android.music', label: 'Musique' }
const CHROME = { package: 'com.android.chrome', label: 'Chrome' }
const DIALER = { package: 'com.google.android.dialer', label: 'Téléphone' }

const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { parentalConsent: true, firstName } })).json()
const putInventory = (device, body) => native(ctx.app, 'PUT', '/api/device/apps', { token: device.accessToken, body })
const getApps = (u, id) => call(ctx.app, 'GET', `/api/children/${id}/apps`, { cookie: u.cookie })
const allow = (u, id, body) => call(ctx.app, 'PUT', `/api/children/${id}/allowed-apps`, { cookie: u.cookie, body })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })
const audits = async (id) => (await ctx.db.query("SELECT details FROM audit_log WHERE action = 'allowed_apps_set' AND target = $1 ORDER BY id", [id])).rows.map((r) => r.details)

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pair(owner, kid) {
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a' } })
  assert.equal(res.statusCode, 201, res.body)
  return res.json()
}
async function setup() {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner)
  const device = await pair(owner, kid)
  return { owner, kid, device }
}

test('inventaire envoyé par le téléphone, lu par la famille (sans icône vide, trié, aucun protégé)', async () => {
  const { owner, kid, device } = await setup()
  const empty = await getApps(owner, kid.id)
  assert.equal(empty.statusCode, 200, empty.body)
  assert.deepEqual(empty.json(), { max: 4, inventory: [], allowed: [] })
  const sent = await putInventory(device, { apps: [CLOCK, CAMERA, CALC] })
  assert.equal(sent.statusCode, 200, sent.body)
  assert.deepEqual(sent.json(), { count: 3 })
  const { inventory } = (await getApps(owner, kid.id)).json()
  assert.deepEqual(inventory, [
    { package: CAMERA.package, label: 'Appareil photo', icon: PNG, allowed: false },
    { package: CALC.package, label: 'Calculatrice', icon: null, allowed: false },
    { package: CLOCK.package, label: 'Horloge', icon: null, allowed: false }
  ])
  // Remplacement complet : ce qui n'est plus envoyé disparaît.
  assert.equal((await putInventory(device, { apps: [CALC] })).statusCode, 200)
  assert.deepEqual((await getApps(owner, kid.id)).json().inventory.map((a) => a.package), [CALC.package])
  // Nom chiffré en base.
  const { rows } = await ctx.db.query('SELECT label_enc FROM device_apps')
  assert.ok(rows.every((r) => !r.label_enc.toString('utf8').includes('Calculatrice')))
})

test('inventaire : champs, bornes et icône validés ; aucune donnée d’usage acceptée', async () => {
  const { device } = await setup()
  const bad = [
    {}, { apps: 'x' }, { apps: [CALC], extra: 1 }, [CALC],
    { apps: [{ ...CALC, usageMinutes: 30 }] },
    { apps: [{ ...CALC, lastUsed: '2026-11-19T10:00:00Z' }] },
    { apps: [{ label: 'Sans paquet' }] },
    { apps: [{ ...CALC, package: 'calculatrice' }] },
    { apps: [{ ...CALC, package: '1com.x.y' }] },
    { apps: [{ ...CALC, package: 'com.x-y.z' }] },
    { apps: [{ ...CALC, package: `com.${'a'.repeat(200)}` }] },
    { apps: [{ ...CALC, label: '' }] },
    { apps: [{ ...CALC, label: '\u0000\u0007' }] },
    { apps: [{ ...CALC, label: 'x'.repeat(81) }] },
    { apps: [{ ...CALC, label: 42 }] },
    { apps: [CALC, CALC] },
    { apps: [{ ...CALC, icon: 'pas du base64 !' }] },
    { apps: [{ ...CALC, icon: Buffer.from('GIF89a pas un png').toString('base64') }] },
    { apps: [{ ...CALC, icon: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(4097)]).toString('base64') }] },
    { apps: [{ ...CALC, icon: 12 }] },
    { apps: [{ ...CALC, browser: 'oui' }] },
    { apps: [{ ...CALC, browser: 1 }] },
    { apps: [{ ...CALC, browser: null }] }
  ]
  for (const body of bad) assert.equal((await putInventory(device, body)).statusCode, 400, JSON.stringify(body).slice(0, 120))
  const many = Array.from({ length: 151 }, (_, i) => ({ package: `com.exemple.app${i}`, label: `App ${i}` }))
  assert.equal((await putInventory(device, { apps: many })).statusCode, 400)
  // 150 applications avec une icône de 4 Ko chacune : acceptées (corps élargi pour cette route).
  const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(4096 - Buffer.from(PNG, 'base64').length)]).toString('base64')
  const ok = await putInventory(device, { apps: many.slice(0, 150).map((a) => ({ ...a, icon: big, label: `${a.label} ${'é'.repeat(70)}` })) })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.deepEqual(ok.json(), { count: 150 })
})

test('inventaire : réservé à une session d’appareil, pour lui-même seulement ; 6 envois par heure', async () => {
  const a = await setup()
  const b = await setup()
  // Un compte parent n'atteint pas la route du téléphone.
  assert.ok([401, 403].includes((await call(ctx.app, 'PUT', '/api/device/apps', { cookie: a.owner.cookie, body: { apps: [CALC] } })).statusCode))
  assert.equal((await native(ctx.app, 'PUT', '/api/device/apps', { body: { apps: [CALC] } })).statusCode, 401)
  // Le téléphone B n'écrit que dans son propre inventaire (aucun identifiant accepté du corps).
  assert.equal((await putInventory(b.device, { apps: [CAMERA] })).statusCode, 200)
  assert.deepEqual((await getApps(a.owner, a.kid.id)).json().inventory, [])
  assert.deepEqual((await getApps(b.owner, b.kid.id)).json().inventory.map((x) => x.package), [CAMERA.package])
  for (let i = 0; i < 5; i++) assert.equal((await putInventory(b.device, { apps: [CAMERA] })).statusCode, 200)
  assert.equal((await putInventory(b.device, { apps: [CAMERA] })).statusCode, 429)
  assert.equal((await putInventory(a.device, { apps: [CAMERA] })).statusCode, 200, 'compté par téléphone')
})

test('inventaire : paquets protégés jamais montrés ; téléphone révoqué : inventaire effacé', async () => {
  const { owner, kid, device } = await setup()
  assert.equal((await putInventory(device, { apps: [CALC, CHROME, DIALER, { package: 'mg.nosytech.akaiky.enfant', label: 'Akaiky' }] })).statusCode, 200)
  assert.deepEqual((await getApps(owner, kid.id)).json().inventory.map((a) => a.package), [CALC.package])
  await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })
  assert.deepEqual((await getApps(owner, kid.id)).json().inventory, [])
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM device_apps WHERE device_id = $1', [device.device.id])).rows[0].n, 0)
})

test('deux téléphones du même enfant : inventaire sans doublon', async () => {
  const { owner, kid, device } = await setup()
  const second = await pair(owner, kid)
  await putInventory(device, { apps: [CALC, CLOCK] })
  await putInventory(second, { apps: [{ ...CALC, label: 'Calcul' }, CAMERA] })
  const { inventory } = (await getApps(owner, kid.id)).json()
  assert.deepEqual(inventory.map((a) => [a.package, a.label]), [[CAMERA.package, 'Appareil photo'], [CALC.package, 'Calcul'], [CLOCK.package, 'Horloge']])
})

test('owner et manager choisissent jusqu’à 4 applications ordonnées ; la 5e est refusée', async () => {
  const { owner, kid, device } = await setup()
  const manager = await join(owner, 'manager')
  await putInventory(device, { apps: [CAMERA, CALC, CLOCK, GALLERY, MUSIC] })
  const res = await allow(owner, kid.id, { packages: [CLOCK.package, CAMERA.package] })
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json(), { max: 4, allowed: [
    { package: CLOCK.package, label: 'Horloge', position: 1 },
    { package: CAMERA.package, label: 'Appareil photo', position: 2 }
  ] })
  const four = [CAMERA, CALC, CLOCK, GALLERY].map((a) => a.package)
  assert.equal((await allow(manager, kid.id, { packages: four })).statusCode, 200)
  const five = await allow(manager, kid.id, { packages: [...four, MUSIC.package] })
  assert.equal(five.statusCode, 400)
  assert.equal(five.json().code, 'too_many_allowed_apps')
  const read = (await getApps(owner, kid.id)).json()
  assert.deepEqual(read.allowed.map((a) => a.package), four)
  assert.deepEqual(read.inventory.filter((a) => a.allowed).map((a) => a.package).sort(), [...four].sort())
  // Liste vide : plus rien d'autorisé.
  assert.deepEqual((await allow(owner, kid.id, { packages: [] })).json().allowed, [])
  assert.deepEqual(await audits(kid.id), [{ count: 2 }, { count: 4 }, { count: 0 }])
})

test('un member reçoit 403 quel que soit le corps ; il lit la liste', async () => {
  const { owner, kid, device } = await setup()
  const member = await join(owner, 'member')
  await putInventory(device, { apps: [CALC] })
  for (const body of [{ packages: [CALC.package] }, { packages: 'x' }, {}, [], { other: 1 }]) {
    assert.equal((await allow(member, kid.id, body)).statusCode, 403, JSON.stringify(body))
  }
  const read = await getApps(member, kid.id)
  assert.equal(read.statusCode, 200)
  assert.deepEqual(read.json().allowed, [])
})

test('enfant d’une autre famille, inconnu ou identifiant invalide : 404 en lecture comme en écriture', async () => {
  const a = await setup()
  const b = await setup()
  await putInventory(b.device, { apps: [CALC] })
  for (const id of [b.kid.id, '00000000-0000-4000-8000-000000000000', 'pas-un-uuid']) {
    assert.equal((await getApps(a.owner, id)).statusCode, 404)
    assert.equal((await allow(a.owner, id, { packages: [CALC.package] })).statusCode, 404)
  }
  assert.deepEqual((await getApps(b.owner, b.kid.id)).json().allowed, [])
})

test('paquet absent de l’inventaire de CET enfant, protégé ou corps invalide : refusé, rien n’est écrit', async () => {
  const a = await setup()
  const other = await child(a.owner, 'Tiana')
  const otherDevice = await pair(a.owner, other)
  await putInventory(a.device, { apps: [CALC] })
  await putInventory(otherDevice, { apps: [CAMERA] })
  const notHere = await allow(a.owner, a.kid.id, { packages: [CAMERA.package] })
  assert.equal(notHere.statusCode, 400)
  assert.equal(notHere.json().code, 'app_not_installed')
  assert.equal(notHere.json().package, CAMERA.package)
  for (const pkg of [CHROME.package, DIALER.package, 'mg.nosytech.akaiky.enfant', 'mg.nosytech.akaiky', 'com.android.settings', 'org.mozilla.firefox', 'com.android.systemui', 'com.android.launcher3']) {
    const res = await allow(a.owner, a.kid.id, { packages: [pkg] })
    assert.equal(res.statusCode, 400, pkg)
    assert.equal(res.json().code, 'protected_app', pkg)
    assert.equal(res.json().package, pkg)
  }
  for (const body of [{}, { packages: 'x' }, { packages: [1] }, { packages: ['pas un paquet'] }, { packages: [CALC.package, CALC.package] }, { packages: [CALC.package], extra: true }, [CALC.package]]) {
    const res = await allow(a.owner, a.kid.id, body)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
    assert.equal(res.json().code, 'invalid_allowed_apps', JSON.stringify(body))
  }
  assert.deepEqual((await getApps(a.owner, a.kid.id)).json().allowed, [])
  assert.deepEqual(await audits(a.kid.id), [])
})

test('navigateur marqué par un téléphone de l’enfant : jamais montré, jamais autorisé', async () => {
  const { owner, kid, device } = await setup()
  const other = await pair(owner, kid)
  const BROWSER = { package: 'com.exemple.web', label: 'Web' }
  await putInventory(device, { apps: [CALC, { ...BROWSER, browser: true }] })
  // L'autre téléphone ne le marque pas : il reste refusé (marqué par l'un des téléphones).
  await putInventory(other, { apps: [{ ...BROWSER, browser: false }, CLOCK] })
  assert.deepEqual((await getApps(owner, kid.id)).json().inventory.map((a) => a.package), [CALC.package, CLOCK.package])
  const res = await allow(owner, kid.id, { packages: [BROWSER.package] })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().code, 'protected_app')
  assert.equal((await allow(owner, kid.id, { packages: [CALC.package, BROWSER.package] })).json().code, 'protected_app')
  assert.deepEqual((await getApps(owner, kid.id)).json().allowed, [])
  // Plus marqué nulle part : autorisable.
  await putInventory(device, { apps: [CALC] })
  assert.equal((await allow(owner, kid.id, { packages: [BROWSER.package] })).statusCode, 200)
})

test('autorisée puis reconnue navigateur : marquée « bloquée », retirable, jamais gardée', async () => {
  const { owner, kid, device } = await setup()
  const WEB = { package: 'com.exemple.lecteur', label: 'Lecteur' }
  await putInventory(device, { apps: [CALC, WEB] })
  assert.equal((await allow(owner, kid.id, { packages: [CALC.package, WEB.package] })).statusCode, 200)
  assert.equal((await getApps(owner, kid.id)).json().allowed.some((a) => a.blocked), false)
  // Le téléphone la reconnaît navigateur ensuite.
  await putInventory(device, { apps: [CALC, { ...WEB, browser: true }] })
  const { allowed, inventory } = (await getApps(owner, kid.id)).json()
  assert.deepEqual(allowed, [
    { package: CALC.package, label: CALC.label, position: 1 },
    { package: WEB.package, label: WEB.label, position: 2, blocked: true }
  ])
  assert.deepEqual(inventory.map((a) => a.package), [CALC.package])
  // Garder la liste telle quelle : refusé, le paquet en cause nommé.
  const kept = await allow(owner, kid.id, { packages: [CALC.package, WEB.package] })
  assert.equal(kept.statusCode, 400)
  assert.deepEqual([kept.json().code, kept.json().package], ['protected_app', WEB.package])
  // Retirée : liste enregistrée sans elle.
  const removed = await allow(owner, kid.id, { packages: [CALC.package] })
  assert.equal(removed.statusCode, 200, removed.body)
  assert.deepEqual((await getApps(owner, kid.id)).json().allowed, [{ package: CALC.package, label: CALC.label, position: 1 }])
})

test('le téléphone reçoit allowedApps ; un changement invalide le 304, une liste inchangée non', async () => {
  const { owner, kid, device } = await setup()
  await putInventory(device, { apps: [CAMERA, CALC] })
  const first = await config(device)
  assert.deepEqual(first.json().allowedApps, [])
  // L'inventaire seul ne change pas la configuration.
  assert.equal((await config(device, first.headers.etag)).statusCode, 304)

  assert.equal((await allow(owner, kid.id, { packages: [CALC.package, CAMERA.package] })).statusCode, 200)
  const second = await config(device, first.headers.etag)
  assert.equal(second.statusCode, 200, 'la liste changée invalide le 304')
  assert.ok(second.json().version > first.json().version)
  assert.notEqual(second.headers.etag, first.headers.etag)
  assert.deepEqual(second.json().allowedApps, [
    { package: CALC.package, label: 'Calculatrice', position: 1 },
    { package: CAMERA.package, label: 'Appareil photo', position: 2 }
  ])
  // Champ par champ : ni icône ni autre donnée.
  assert.deepEqual(Object.keys(second.json().allowedApps[0]).sort(), ['label', 'package', 'position'])

  // Même liste, même ordre : ni écriture ni audit, le téléphone reste sur son 304.
  assert.equal((await allow(owner, kid.id, { packages: [CALC.package, CAMERA.package] })).statusCode, 200)
  assert.equal((await config(device, second.headers.etag)).statusCode, 304)
  assert.equal((await audits(kid.id)).length, 1)
  // Ordre changé : nouvelle version.
  assert.equal((await allow(owner, kid.id, { packages: [CAMERA.package, CALC.package] })).statusCode, 200)
  const third = await config(device, second.headers.etag)
  assert.equal(third.statusCode, 200)
  assert.deepEqual(third.json().allowedApps.map((a) => a.package), [CAMERA.package, CALC.package])
})

test('le nom autorisé est un instantané : une application retirée du téléphone reste dans la liste', async () => {
  const { owner, kid, device } = await setup()
  await putInventory(device, { apps: [CALC] })
  await allow(owner, kid.id, { packages: [CALC.package] })
  await putInventory(device, { apps: [CAMERA] })
  const read = (await getApps(owner, kid.id)).json()
  assert.deepEqual(read.allowed, [{ package: CALC.package, label: 'Calculatrice', position: 1 }])
  assert.deepEqual((await config(device)).json().allowedApps.map((a) => a.package), [CALC.package])
})

test('export : liste autorisée de chaque enfant, sans l’inventaire', async () => {
  const { owner, kid, device } = await setup()
  await putInventory(device, { apps: [CAMERA, CALC] })
  await allow(owner, kid.id, { packages: [CAMERA.package] })
  const res = await call(ctx.app, 'GET', '/api/families/me/export', { cookie: owner.cookie })
  assert.equal(res.statusCode, 200, res.body)
  const [exported] = res.json().children
  assert.deepEqual(exported.allowedApps, [{ package: CAMERA.package, label: 'Appareil photo', position: 1 }])
  assert.ok(!res.body.includes('Calculatrice'), 'inventaire non exporté')
  assert.ok(!res.body.includes(PNG), 'icône non exportée')
})
