import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, native, newUser, tokenIn, ORIGIN } from './helpers.js'
import { DEVICE_ADMIN_COMPONENT, MAX_DEVICES } from '../src/routes/devices.js'
import { loadConfig } from '../src/config.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { firstName } })).json()
const pairing = (u, childId) => call(ctx.app, 'POST', `/api/children/${childId}/pairing`, { cookie: u.cookie })
const tokenOf = (res) => res.json().provisioning[BUNDLE]['akaiky.pairing']
const pair = (token, extra = {}) => native(ctx.app, 'POST', '/api/device/pair', { body: { token, model: 'Pixel 3a', osVersion: '14', appVersion: '1.0', ...extra } })
const devices = (u, childId) => call(ctx.app, 'GET', `/api/children/${childId}/devices`, { cookie: u.cookie })

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}

// Parent avec famille et enfant, et un téléphone appairé.
async function paired() {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const res = await pair(tokenOf(await pairing(owner, fy.id)))
  assert.equal(res.statusCode, 201, res.body)
  return { owner, fy, device: res.json() }
}

test('le QR porte le receveur, l’APK, la somme du certificat et un jeton de 15 minutes', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const res = await pairing(owner, fy.id)
  assert.equal(res.statusCode, 201, res.body)
  const { expiresAt, provisioning } = res.json()
  const minutes = (new Date(expiresAt) - Date.now()) / 60000
  // Horloges de la base et du test : quelques secondes d'écart tolérées.
  assert.ok(minutes > 14.5 && minutes < 15.5, `expire dans ${minutes} min`)
  assert.equal(provisioning['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'], DEVICE_ADMIN_COMPONENT)
  assert.equal(provisioning['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'], APK.DEVICE_APK_URL)
  assert.equal(provisioning['android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM'], APK.DEVICE_APK_SIGNATURE_SHA256)
  assert.equal(provisioning[BUNDLE]['akaiky.api'], ORIGIN)
  assert.match(tokenOf(res), /^[A-Za-z0-9_-]{43}$/)
  // Aucun secret durable : le jeton n'est stocké qu'haché.
  const { rows } = await ctx.db.query('SELECT token_hash FROM pairing_tokens WHERE child_id = $1', [fy.id])
  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].token_hash.toString('base64url'), tokenOf(res))
})

test('un nouveau QR remplace le précédent', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const first = tokenOf(await pairing(owner, fy.id))
  const second = tokenOf(await pairing(owner, fy.id))
  assert.equal((await pair(first)).statusCode, 401)
  assert.equal((await pair(second)).statusCode, 201)
})

test('jeton échangé une fois : rejeu, jeton expiré, jeton inconnu → 401 identique', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const token = tokenOf(await pairing(owner, fy.id))
  const ok = await pair(token)
  assert.equal(ok.statusCode, 201, ok.body)
  assert.deepEqual(Object.keys(ok.json()).sort(), ['accessToken', 'child', 'device', 'expiresIn', 'refreshToken'])
  assert.equal(ok.json().child.id, fy.id)
  const replay = await pair(token)
  assert.equal(replay.statusCode, 401)
  assert.equal(replay.json().code, 'pairing_invalid')
  const expired = tokenOf(await pairing(owner, fy.id))
  await ctx.db.query("UPDATE pairing_tokens SET expires_at = now() - interval '1 second' WHERE child_id = $1 AND used_at IS NULL", [fy.id])
  assert.deepEqual((await pair(expired)).json(), replay.json())
  assert.deepEqual((await pair('x'.repeat(43))).json(), replay.json())
})

test('deux échanges simultanés du même jeton : un seul succès, un seul appareil', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const token = tokenOf(await pairing(owner, fy.id))
  const results = await Promise.all(Array.from({ length: 5 }, () => pair(token)))
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 401, 401, 401, 401])
  assert.equal((await devices(owner, fy.id)).json().length, 1)
})

test('rôles : un member ne génère pas de QR ni ne révoque (403) ; il voit les téléphones', async () => {
  const { owner, fy, device } = await paired()
  const member = await join(owner, 'member')
  const manager = await join(owner, 'manager')
  assert.equal((await pairing(member, fy.id)).statusCode, 403)
  assert.equal((await pairing(manager, fy.id)).statusCode, 201)
  assert.equal((await devices(member, fy.id)).json().length, 1)
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: member.cookie })).statusCode, 403)
})

test('famille A sur l’enfant ou le téléphone de B → 404 ; sans session → 401', async () => {
  const b = await paired()
  const a = await newUser(ctx)
  await family(a)
  assert.equal((await pairing(a, b.fy.id)).statusCode, 404)
  assert.equal((await devices(a, b.fy.id)).statusCode, 404)
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${b.device.device.id}/revoke`, { cookie: a.cookie })).statusCode, 404)
  assert.equal((await call(ctx.app, 'POST', `/api/children/${b.fy.id}/pairing`)).statusCode, 401)
  // Le téléphone de B fonctionne toujours.
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: b.device.accessToken })).statusCode, 200)
})

test('la session d’appareil voit son enfant ; elle n’atteint aucune route de compte', async () => {
  const { fy, device } = await paired()
  const me = await native(ctx.app, 'GET', '/api/device/me', { token: device.accessToken })
  assert.equal(me.statusCode, 200, me.body)
  assert.deepEqual(me.json(), { device: { id: device.device.id }, child: { id: fy.id, firstName: 'Fy' } })
  for (const [method, url] of [['GET', '/api/auth/me'], ['GET', '/api/children'], ['GET', '/api/families/me'], ['GET', `/api/children/${fy.id}/devices`], ['POST', `/api/children/${fy.id}/pairing`]]) {
    const r = await native(ctx.app, method, url, { token: device.accessToken })
    // /api/auth/me répond 200 sans utilisateur (session absente) : jamais un compte.
    if (url === '/api/auth/me') assert.equal(r.json().user, null, url)
    else assert.equal(r.statusCode, 401, `${method} ${url}`)
  }
})

test('une session de compte n’atteint pas les routes d’appareil, ni par cookie ni par Bearer', async () => {
  const owner = await newUser(ctx)
  assert.equal((await call(ctx.app, 'GET', '/api/device/me', { cookie: owner.cookie })).statusCode, 403)
  const nat = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: owner.email, password: owner.password } })
  assert.equal(nat.statusCode, 200, nat.body)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: nat.json().accessToken })).statusCode, 401)
  // Origine web : les routes d'appareil sont réservées à l'application native.
  assert.equal((await call(ctx.app, 'POST', '/api/device/pair', { body: { token: 'x'.repeat(43) } })).statusCode, 403)
})

test('révocation : la requête suivante du téléphone reçoit 401, le renouvellement aussi', async () => {
  const { owner, fy, device } = await paired()
  const revoke = await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })
  assert.equal(revoke.statusCode, 200, revoke.body)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: device.accessToken })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })).statusCode, 401)
  assert.deepEqual((await devices(owner, fy.id)).json(), [])
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 404)
})

test('renouvellement tourné ; l’ancien jeton une fois ; le successeur écarté ferme la session', async () => {
  const { device } = await paired()
  const r1 = await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })
  assert.equal(r1.statusCode, 200, r1.body)
  assert.notEqual(r1.json().refreshToken, device.refreshToken)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: r1.json().accessToken })).statusCode, 200)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: device.accessToken })).statusCode, 401)
  // Réponse perdue : l'app repasse l'ancien jeton, accepté une fois.
  const again = await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })
  assert.equal(again.statusCode, 200)
  // Le successeur écarté (r1) réapparaît : rejeu, session fermée et signalée.
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: r1.json().refreshToken } })).statusCode, 401)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: again.json().accessToken })).statusCode, 401)
  const { rows } = await ctx.db.query("SELECT 1 FROM security_alerts WHERE kind = 'device_refresh_replay'")
  assert.equal(rows.length, 1)
})

test('session d’appareil : renouvelable 180 jours après le dernier usage, sans plafond absolu', async () => {
  const { device } = await paired()
  // Session créée il y a deux ans : toujours renouvelable (le téléphone ne se réappaire qu'en le réinitialisant).
  await ctx.db.query("UPDATE device_sessions SET created_at = now() - interval '730 days' WHERE device_id = $1", [device.device.id])
  const r = await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })
  assert.equal(r.statusCode, 200, r.body)
  const { rows: [s] } = await ctx.db.query('SELECT extract(epoch FROM refresh_expires_at - now()) / 86400 AS days FROM device_sessions WHERE device_id = $1', [device.device.id])
  assert.ok(Math.abs(Number(s.days) - 180) < 0.01, `${s.days} jours`)
})

test('plafond de téléphones actifs : refusé dès le QR, et à l’échange s’il est atteint entre-temps', async () => {
  const { owner, fy } = await paired()
  for (let i = 2; i < MAX_DEVICES; i++) assert.equal((await pair(tokenOf(await pairing(owner, fy.id)))).statusCode, 201)
  // QR émis sous le plafond ; un téléphone s'ajoute avant l'échange : refusé à l'échange.
  const last = tokenOf(await pairing(owner, fy.id))
  const { rows: [extra] } = await ctx.db.query('INSERT INTO child_devices(family_id, child_id) SELECT family_id, id FROM children WHERE id = $1 RETURNING id', [fy.id])
  await ctx.db.query("INSERT INTO device_sessions(token_hash, device_id, expires_at, refresh_hash, refresh_expires_at) VALUES (sha256(random()::text::bytea), $1, now(), sha256(random()::text::bytea), now() + interval '1 day')", [extra.id])
  const late = await pair(last)
  assert.equal(late.statusCode, 409)
  assert.equal(late.json().code, 'too_many_devices')
  // Plafond atteint : le QR lui-même est refusé, avant toute réinitialisation du téléphone.
  const atQr = await pairing(owner, fy.id)
  assert.equal(atQr.statusCode, 409)
  assert.equal(atQr.json().code, 'too_many_devices')
  // Un téléphone dont la session ne se renouvelle plus libère sa place.
  await ctx.db.query("UPDATE device_sessions SET refresh_expires_at = now() - interval '1 second' WHERE device_id = $1", [extra.id])
  assert.equal((await pairing(owner, fy.id)).statusCode, 201)
})

test('un enfant retiré emporte ses téléphones', async () => {
  const { owner } = await paired()
  const kid = await child(owner, 'Tiana')
  const d = (await pair(tokenOf(await pairing(owner, kid.id)))).json()
  assert.equal((await call(ctx.app, 'DELETE', `/api/children/${kid.id}`, { cookie: owner.cookie })).statusCode, 200)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: d.accessToken })).statusCode, 401)
})

test('champs inconnus refusés ; texte de l’appareil nettoyé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const token = tokenOf(await pairing(owner, fy.id))
  assert.equal((await pair(token, { familyId: fy.id })).statusCode, 400)
  assert.equal((await pair(token, { model: 'Galaxy <script>\u0000' })).statusCode, 201)
  assert.equal((await devices(owner, fy.id)).json()[0].model, 'Galaxy script')
})

test('sans APK configuré : pas de QR (503) ; configuration incomplète refusée', async () => {
  const other = await startApp(dbh.url, { API_RATE_LIMIT: '100000' })
  try {
    const owner = await newUser(other)
    await call(other.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'F' } })
    const fy = (await call(other.app, 'POST', '/api/children', { cookie: owner.cookie, body: { firstName: 'Fy' } })).json()
    const res = await call(other.app, 'POST', `/api/children/${fy.id}/pairing`, { cookie: owner.cookie })
    assert.equal(res.statusCode, 503)
    assert.equal(res.json().code, 'pairing_unavailable')
  } finally { await other.close() }
  const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x', APP_ORIGIN: ORIGIN }
  assert.throws(() => loadConfig({ ...base, DEVICE_APK_URL: APK.DEVICE_APK_URL }), /vont ensemble/)
  assert.throws(() => loadConfig({ ...base, ...APK, DEVICE_APK_URL: 'http://akaiky.test/a.apk' }), /DEVICE_APK_URL/)
  assert.throws(() => loadConfig({ ...base, ...APK, DEVICE_APK_SIGNATURE_SHA256: 'abc' }), /DEVICE_APK_SIGNATURE_SHA256/)
  // Sans l'origine de la WebView Android, chaque échange serait refusé : pas de QR possible.
  assert.throws(() => loadConfig({ ...base, ...APK, NATIVE_ORIGINS: 'capacitor://localhost' }), /NATIVE_ORIGINS/)
  assert.ok(loadConfig({ ...base, ...APK, NATIVE_ORIGINS: 'https://localhost' }).deviceApk)
})

test('configuration : contacts de SON enfant seulement, ETag et 304, changement vu tout de suite', async () => {
  const { owner, fy, device } = await paired()
  const add = (childId, name, phone) => call(ctx.app, 'POST', `/api/children/${childId}/contacts`, { cookie: owner.cookie, body: { name, phone } })
  assert.equal((await add(fy.id, 'Maman', '034 12 345 67')).statusCode, 201)
  // Un autre enfant de la même famille, et un enfant d'une autre famille : jamais visibles.
  const tiana = await child(owner, 'Tiana')
  assert.equal((await add(tiana.id, 'Dadabe', '033 11 222 33')).statusCode, 201)
  const other = await paired()
  assert.equal((await call(ctx.app, 'POST', `/api/children/${other.fy.id}/contacts`, { cookie: other.owner.cookie, body: { name: 'Voisin', phone: '032 98 765 43' } })).statusCode, 201)

  const first = await native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken })
  assert.equal(first.statusCode, 200, first.body)
  assert.deepEqual(first.json().contacts.map((c) => [c.name, c.phone, c.position]), [['Maman', '+261341234567', 1]])
  assert.equal(first.json().country, 'MG')
  assert.deepEqual(Object.keys(first.json().contacts[0]).sort(), ['avatarColor', 'id', 'name', 'phone', 'position'])
  const etag = first.headers.etag
  assert.match(etag, /^"[0-9a-f-]+\.\d+"$/)
  assert.equal(first.headers['access-control-expose-headers'], 'etag')

  // Rien n'a changé : 304 sans corps.
  const same = await native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: { 'if-none-match': etag } })
  assert.equal(same.statusCode, 304)
  assert.equal(same.body, '')
  // Le parent ajoute un contact : la version change, le relevé suivant le voit.
  assert.equal((await add(fy.id, 'Papa', '033 12 345 67')).statusCode, 201)
  const next = await native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: { 'if-none-match': etag } })
  assert.equal(next.statusCode, 200)
  assert.notEqual(next.headers.etag, etag)
  assert.deepEqual(next.json().contacts.map((c) => c.name), ['Maman', 'Papa'])
  // Le téléphone ne choisit pas l'enfant : aucun paramètre accepté pour un autre.
  assert.equal((await native(ctx.app, 'GET', `/api/device/config?childId=${tiana.id}`, { token: device.accessToken })).json().contacts.length, 2)
})

test('configuration : sans session d’appareil, ou téléphone révoqué → 401 ; session de compte refusée', async () => {
  const { owner, device } = await paired()
  assert.equal((await native(ctx.app, 'GET', '/api/device/config')).statusCode, 401)
  const nat = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: owner.email, password: owner.password } })
  assert.equal((await native(ctx.app, 'GET', '/api/device/config', { token: nat.json().accessToken })).statusCode, 401)
  await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })
  assert.equal((await native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken })).statusCode, 401)
})

test('pré-vol CORS de l’app enfant : if-none-match autorisé', async () => {
  const res = await ctx.app.inject({ method: 'OPTIONS', url: '/api/device/config', headers: { origin: 'https://localhost', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization, if-none-match' } })
  assert.equal(res.statusCode, 204)
  assert.match(res.headers['access-control-allow-headers'], /if-none-match/)
})

test('configuration : ETag lié à l’enfant ; validateur faible et liste acceptés ; autre enfant → 200', async () => {
  const a = await paired()
  const b = await paired()
  const ra = await native(ctx.app, 'GET', '/api/device/config', { token: a.device.accessToken })
  const tag = ra.headers.etag
  assert.ok(tag.includes(a.fy.id))
  assert.equal((await native(ctx.app, 'GET', '/api/device/config', { token: a.device.accessToken, headers: { 'if-none-match': `W/${tag}` } })).statusCode, 304)
  assert.equal((await native(ctx.app, 'GET', '/api/device/config', { token: a.device.accessToken, headers: { 'if-none-match': `"x", ${tag}` } })).statusCode, 304)
  assert.equal((await native(ctx.app, 'GET', '/api/device/config', { token: a.device.accessToken, headers: { 'if-none-match': '*' } })).statusCode, 200)
  // Même version chez l'enfant de B : l'ETag de A n'y vaut pas 304.
  assert.equal((await native(ctx.app, 'GET', '/api/device/config', { token: b.device.accessToken, headers: { 'if-none-match': tag } })).statusCode, 200)
})
