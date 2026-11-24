// Position à la demande (NAR-203) : demande, réveil, relevé, lecture, isolation, chiffrement.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'
import { openField } from '../src/crypto-fields.js'
import { LOCATE_MAX, positionAad } from '../src/routes/location.js'
import { createFakeProvider, runPushWorker } from '../src/push.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const locate = (u, childId, body) => call(ctx.app, 'POST', `/api/children/${childId}/locate`, { cookie: u.cookie, body })
const position = (u, childId) => call(ctx.app, 'GET', `/api/children/${childId}/position`, { cookie: u.cookie })
const report = (device, body) => native(ctx.app, 'POST', '/api/device/positions', { token: device.accessToken, body })
const pending = (device) => native(ctx.app, 'GET', '/api/device/locate', { token: device.accessToken })
const HERE = { lat: -18.879190, lng: 47.507905, accuracyM: 12.4, ageS: 0 }

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function child(owner, firstName) {
  return (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
}
async function pair(owner, kid) {
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return res.json()
}
async function pairedChild(owner, firstName) {
  const kid = await child(owner, firstName)
  return { kid, device: await pair(owner, kid) }
}
const pushToken = (device, token) => native(ctx.app, 'PUT', '/api/device/push/token', { token: device.accessToken, body: { token, platform: 'android', lang: 'fr' } })
const queuedLocates = async (childId) => (await ctx.db.query(
  "SELECT t.device_id FROM push_outbox o JOIN push_tokens t ON t.id = o.token_id WHERE o.event = 'locate' AND o.ref = $1 ORDER BY t.device_id", [childId])).rows.map((r) => r.device_id)

test('un membre demande la position : réveil du téléphone, « qui regarde », relevé, puis lecture avec précision et heure', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  const me = (await call(ctx.app, 'GET', '/api/auth/me', { cookie: owner.cookie })).json().user
  assert.equal((await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Maman', phone: '034 12 345 67', memberUserId: me.id } })).statusCode, 201)
  assert.equal((await pushToken(fy.device, 'fcm-enfant-fy')).statusCode, 200)

  // Rien de demandé : aucun relevé dû, aucune position.
  assert.deepEqual((await pending(fy.device)).json(), { pending: false, watchers: [], watchingUntil: null })
  assert.deepEqual((await position(member, fy.kid.id)).json(), { position: null, requestedAt: null, watchingUntil: null })

  const asked = await locate(owner, fy.kid.id)
  assert.equal(asked.statusCode, 200, asked.body)
  const until = Date.parse(asked.json().watchingUntil)
  assert.ok(until > Date.now() + 60_000 && until <= Date.now() + 121_000, 'consultation de 2 minutes')
  assert.deepEqual([asked.json().devices, asked.json().woken], [1, 1])
  assert.deepEqual(await queuedLocates(fy.kid.id), [fy.device.device.id], 'réveil silencieux mis en file pour le téléphone de Fy')
  const { rows: [push] } = await ctx.db.query("SELECT kind, owner_key FROM push_outbox WHERE event = 'locate' AND ref = $1", [fy.kid.id])
  assert.equal(push.kind, 'data', 'réveil silencieux : aucune notification affichée')
  assert.equal(push.owner_key, `device:${fy.device.device.id}:locate`, 'plafond horaire propre aux réveils locate')

  // Le téléphone voit qu'on le regarde : nom du contact lié, rien d'autre.
  const seen = (await pending(fy.device)).json()
  assert.equal(seen.pending, true)
  assert.deepEqual(seen.watchers, [{ name: 'Maman' }])
  assert.equal(Date.parse(seen.watchingUntil), until)

  // Le téléphone réveillé prend son relevé 10 s après la demande et l'envoie 5 s plus tard.
  await ctx.db.query("UPDATE location_requests SET created_at = created_at - interval '15 seconds' WHERE child_id = $1", [fy.kid.id])
  const sent = await report(fy.device, { ...HERE, ageS: 5 })
  assert.equal(sent.statusCode, 200, sent.body)
  assert.equal((await pending(fy.device)).json().pending, false, 'relevé fait : plus rien de dû')

  // Tous les membres lisent la dernière position ; seul le demandeur a une demande en cours.
  for (const u of [owner, member]) {
    const got = (await position(u, fy.kid.id)).json()
    assert.deepEqual({ ...got.position, recordedAt: undefined }, { lat: -18.87919, lng: 47.507905, accuracyM: 12, source: 'on_demand', recordedAt: undefined })
    const age = Date.now() - Date.parse(got.position.recordedAt)
    assert.ok(age >= 5000 && age < 15_000, `âge du relevé d'après ageS (${age} ms)`)
  }
  assert.ok((await position(owner, fy.kid.id)).json().watchingUntil)
  assert.equal((await position(member, fy.kid.id)).json().watchingUntil, null)

  // Une nouvelle demande rend un relevé dû à nouveau ; le téléphone réveillé il y a moins
  // d'une minute ne l'est pas une seconde fois.
  const second = await locate(member, fy.kid.id)
  assert.equal(second.statusCode, 200)
  assert.deepEqual([second.json().devices, second.json().woken], [1, 0])
  assert.equal((await queuedLocates(fy.kid.id)).length, 1)
  const again = (await pending(fy.device)).json()
  assert.equal(again.pending, true)
  assert.equal(again.watchers.length, 2)
})

test('aucun suivi : un relevé sans demande ouverte, ou après la consultation, est refusé et rien n’est gardé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const none = await report(fy.device, HERE)
  assert.equal(none.statusCode, 409)
  assert.equal(none.json().code, 'no_request')
  assert.equal((await locate(owner, fy.kid.id)).statusCode, 200)
  // Position « dernière connue » prise avant la demande : ne répond pas à la demande.
  const stale = await report(fy.device, { ...HERE, ageS: 30 })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().code, 'stale_position')
  assert.equal((await pending(fy.device)).json().pending, true, 'toujours dû')
  await ctx.db.query("UPDATE location_requests SET created_at = now() - interval '3 minutes', watch_until = now() - interval '1 minute' WHERE child_id = $1", [fy.kid.id])
  assert.equal((await report(fy.device, HERE)).statusCode, 409, 'consultation finie')
  assert.deepEqual((await pending(fy.device)).json(), { pending: false, watchers: [], watchingUntil: null })
  assert.equal((await ctx.db.query('SELECT 1 FROM positions WHERE child_id = $1', [fy.kid.id])).rowCount, 0)
})

test('isolation : une autre famille ne demande ni ne lit rien (404) ; le téléphone de X n’écrit que pour X', async () => {
  const a = await newUser(ctx); await family(a)
  const b = await newUser(ctx); await family(b)
  const fy = await pairedChild(a, 'Fy')
  const tiana = await pairedChild(a, 'Tiana')
  const other = await pairedChild(b, 'Koto')
  assert.equal((await locate(a, fy.kid.id)).statusCode, 200)
  assert.equal((await report(fy.device, HERE)).statusCode, 200)

  for (const res of [await locate(b, fy.kid.id), await position(b, fy.kid.id), await locate(b, 'pas-un-uuid'), await position(b, '00000000-0000-4000-8000-000000000000')]) {
    assert.equal(res.statusCode, 404, res.body)
    assert.equal(res.json().code, 'child_not_found')
  }
  const outsider = await newUser(ctx)
  assert.equal((await position(outsider, fy.kid.id)).statusCode, 404, 'sans famille')
  assert.equal((await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/position`)).statusCode, 401, 'sans session')
  // La demande pour Fy n'ouvre rien pour Tiana (même famille) ni pour Koto (autre famille).
  assert.equal((await report(tiana.device, HERE)).statusCode, 409)
  assert.equal((await report(other.device, HERE)).statusCode, 409)
  assert.equal((await pending(tiana.device)).json().pending, false)
  // Le téléphone ne peut pas nommer un autre enfant : champ inconnu.
  assert.equal((await report(fy.device, { ...HERE, childId: tiana.kid.id })).statusCode, 400)
  assert.equal((await position(a, tiana.kid.id)).json().position, null)
  // Une session de compte n'atteint pas la route du téléphone, ni l'inverse.
  // (origine web : routes d'appareil refusées ; Bearer d'un compte : inconnu des sessions d'appareil).
  assert.equal((await call(ctx.app, 'POST', '/api/device/positions', { cookie: a.cookie, body: HERE })).statusCode, 403)
  const nat = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: a.email, password: a.password } })
  assert.equal((await native(ctx.app, 'POST', '/api/device/positions', { token: nat.json().accessToken, body: HERE })).statusCode, 401)
  assert.equal((await native(ctx.app, 'GET', `/api/children/${fy.kid.id}/position`, { token: fy.device.accessToken })).statusCode, 401)
})

test('réveil : seulement les téléphones actifs de l’enfant ; téléphone révoqué ni réveillé ni écouté', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner, 'Fy')
  const first = await pair(owner, kid), second = await pair(owner, kid)
  const sibling = await pairedChild(owner, 'Tiana')
  for (const [d, t] of [[first, 'fcm-1'], [second, 'fcm-2'], [sibling.device, 'fcm-3']]) assert.equal((await pushToken(d, t)).statusCode, 200)
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${first.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 200)
  const asked = (await locate(owner, kid.id)).json()
  assert.deepEqual([asked.devices, asked.woken], [1, 1])
  assert.deepEqual(await queuedLocates(kid.id), [second.device.id])
  assert.equal((await report(first, HERE)).statusCode, 401)
})

test('entrées : bornes, champs connus seulement, relevé trop vieux refusé ; demande sans corps', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await locate(owner, fy.kid.id, { userId: owner.id })).statusCode, 400, 'aucun champ accepté')
  assert.equal((await locate(owner, fy.kid.id)).statusCode, 200)
  for (const body of [
    { ...HERE, lat: 91 }, { ...HERE, lat: -90.5 }, { ...HERE, lng: 180.1 }, { ...HERE, accuracyM: -1 }, { ...HERE, accuracyM: 100001 },
    { ...HERE, ageS: 121 }, { ...HERE, ageS: -1 }, { ...HERE, ageS: 1.5 }, { ...HERE, lat: '-18.8' },
    { lat: HERE.lat, lng: HERE.lng, accuracyM: 10 }, { ...HERE, recordedAt: new Date().toISOString() }, { ...HERE, source: 'sos' }
  ]) assert.equal((await report(fy.device, body)).statusCode, 400, JSON.stringify(body))
  assert.equal((await native(ctx.app, 'POST', '/api/device/positions', { body: HERE })).statusCode, 401)
  assert.equal((await ctx.db.query('SELECT 1 FROM positions WHERE child_id = $1', [fy.kid.id])).rowCount, 0)
})

test('limites : demandes par membre et par enfant, relevés par téléphone', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  for (let i = 0; i < LOCATE_MAX; i++) assert.equal((await locate(owner, fy.kid.id)).statusCode, 200)
  const over = await locate(owner, fy.kid.id)
  assert.equal(over.statusCode, 429)
  assert.equal(over.json().code, 'locate_rate_limited')
  assert.equal((await locate(member, fy.kid.id)).statusCode, 200, 'la limite est propre à chaque membre')
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await report(fy.device, HERE)).statusCode)
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429])
  assert.equal((await report(fy.device, HERE)).json().code, 'positions_rate_limited')
})

test('membre parti : il ne regarde plus, sa demande n’ouvre plus de relevé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await locate(member, fy.kid.id)).statusCode, 200)
  assert.equal((await pending(fy.device)).json().watchers.length, 1)
  const me = (await call(ctx.app, 'GET', '/api/auth/me', { cookie: member.cookie })).json().user
  assert.equal((await call(ctx.app, 'DELETE', `/api/families/me/members/${me.id}`, { cookie: owner.cookie })).statusCode, 200)
  assert.deepEqual((await pending(fy.device)).json(), { pending: false, watchers: [], watchingUntil: null })
  assert.equal((await report(fy.device, HERE)).statusCode, 409)
})

test('chiffrement au repos, rien dans l’audit ; l’export du gestionnaire contient les positions ; aucune route admin', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await locate(owner, fy.kid.id)).statusCode, 200)
  assert.equal((await report(fy.device, HERE)).statusCode, 200)
  const { rows: [row] } = await ctx.db.query('SELECT * FROM positions WHERE child_id = $1', [fy.kid.id])
  for (const col of ['lat_enc', 'lng_enc']) {
    assert.ok(Buffer.isBuffer(row[col]))
    assert.ok(!row[col].toString('latin1').includes('18.87') && !row[col].toString('latin1').includes('47.50'), `${col} chiffré`)
  }
  const key = ctx.app.config.dataKey
  assert.equal(openField(row.lat_enc, key, positionAad(row.id, 'lat')), '-18.87919')
  assert.throws(() => openField(row.lat_enc, key, positionAad(row.id, 'lng')), 'chiffré lié à sa colonne')
  assert.deepEqual(Object.keys(row).sort(), ['accuracy_m', 'child_id', 'device_id', 'family_id', 'id', 'lat_enc', 'lng_enc', 'received_at', 'recorded_at', 'sos_id', 'source'])

  const { rows: audits } = await ctx.db.query("SELECT action, target, details FROM audit_log WHERE action LIKE 'position%' AND target = $1", [fy.kid.id])
  assert.deepEqual(audits, [{ action: 'position_requested', target: fy.kid.id, details: null }])
  const everything = JSON.stringify((await ctx.db.query('SELECT details FROM audit_log')).rows) + JSON.stringify((await ctx.db.query('SELECT * FROM push_outbox')).rows)
  assert.ok(!everything.includes('18.87') && !everything.includes('47.50'), 'aucune coordonnée dans l’audit ni dans la file push')

  const exported = (await call(ctx.app, 'GET', '/api/families/me/export', { cookie: owner.cookie })).json()
  assert.deepEqual(exported.children[0].positions.map((p) => [p.lat, p.lng, p.accuracyM, p.source]), [[-18.87919, 47.507905, 12, 'on_demand']])
  assert.equal(exported.children[0].positionsTruncated, false)

  const adminRoutes = ctx.app.printRoutes({ commonPrefix: false }).split('\n').filter((l) => l.includes('admin'))
  assert.ok(adminRoutes.length > 0)
  assert.ok(!adminRoutes.some((l) => /position|locat/i.test(l)), adminRoutes.join('\n'))
})

test('membre désactivé par l’équipe : il ne regarde plus, sa demande n’ouvre plus de relevé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await locate(member, fy.kid.id)).statusCode, 200)
  await ctx.db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [member.id])
  assert.deepEqual((await pending(fy.device)).json(), { pending: false, watchers: [], watchingUntil: null })
  assert.equal((await report(fy.device, HERE)).statusCode, 409)
})

test('lecture : la position la plus récemment relevée gagne ; une ligne illisible ne masque pas les précédentes', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner, 'Fy')
  const one = await pair(owner, kid), two = await pair(owner, kid)
  assert.equal((await locate(owner, kid.id)).statusCode, 200)
  await ctx.db.query("UPDATE location_requests SET created_at = created_at - interval '100 seconds' WHERE child_id = $1", [kid.id])
  assert.equal((await report(one, { ...HERE, lat: -18.9, ageS: 0 })).statusCode, 200)
  // Reçu après, mais relevé 90 s plus tôt par l'autre téléphone.
  assert.equal((await report(two, { ...HERE, lat: -19.1, ageS: 90 })).statusCode, 200)
  assert.equal((await position(owner, kid.id)).json().position.lat, -18.9)
  // La plus récente devient illisible : la précédente est rendue.
  await ctx.db.query("UPDATE positions SET recorded_at = now() + interval '1 minute' WHERE child_id = $1 AND device_id = $2", [kid.id, two.device.id])
  assert.equal((await position(owner, kid.id)).json().position.lat, -19.1)
  await ctx.db.query("UPDATE positions SET lat_enc = lng_enc WHERE child_id = $1 AND device_id = $2", [kid.id, two.device.id])
  assert.equal((await position(owner, kid.id)).json().position.lat, -18.9)
})

test('réveil locate en échec passager : jamais retenté', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await pushToken(fy.device, 'fcm-retry')).statusCode, 200)
  await ctx.db.query("UPDATE push_outbox SET status = 'failed' WHERE status = 'pending'")
  assert.equal((await locate(owner, fy.kid.id)).statusCode, 200)
  const provider = createFakeProvider()
  provider.failNext('retry')
  const quiet = { info() {}, error() {}, warn() {} }
  const run = await runPushWorker(ctx.db, provider, ctx.app.config, quiet)
  assert.deepEqual([run.sent, run.retried, run.failed], [0, 0, 1])
  const { rows } = await ctx.db.query("SELECT status FROM push_outbox WHERE event = 'locate' AND ref = $1", [fy.kid.id])
  assert.deepEqual(rows, [{ status: 'failed' }])
})
