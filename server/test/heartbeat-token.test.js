// Jeton « signal de vie » du natif en arrière-plan (NAR-180, 021_heartbeat_tokens.sql).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, native, newUser } from './helpers.js'
import { runRetention } from '../src/jobs.js'
import { HEARTBEAT_TOKEN_MAX, HEARTBEAT_TOKEN_DAYS } from '../src/routes/device-status.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const OK = { batteryPct: 80, charging: false, network: 'wifi', simState: 'ready', background: true }
const issue = (device) => native(ctx.app, 'POST', '/api/device/heartbeat-token', { token: device.accessToken, body: {} })
// Envoi du natif : hors WebView, donc sans origine ; schéma « Heartbeat ».
const beatWith = (token, { origin, body = OK } = {}) => ctx.app.inject({
  method: 'POST', url: '/api/device/heartbeat', payload: body,
  headers: { authorization: `Heartbeat ${token}`, ...(origin ? { origin } : {}) }
})
const statusOf = async (id) => (await ctx.db.query('SELECT battery_pct, status_at, heartbeat_token_hash, heartbeat_token_expires_at FROM child_devices WHERE id = $1', [id])).rows[0]

// Arbre de printRoutes() remis à plat : un nœud enfant prolonge le chemin de son parent.
function deviceRoutes(app) {
  const stack = [], out = []
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?/.exec(line)
    if (!m) continue
    const depth = m[1].length / 4
    stack.length = depth
    stack.push(m[2])
    const url = stack.join('')
    if (m[3] && url.startsWith('/api/device/')) for (const method of m[3].split(', ')) if (method !== 'HEAD') out.push([method, url])
  }
  return out
}

async function familyWithDevice() {
  const owner = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel' } })
  assert.equal(res.statusCode, 201, res.body)
  return { owner, kid, device: res.json() }
}

test('émis par la session d’appareil, rendu une fois ; seule son empreinte est gardée ; il ouvre le signal', async () => {
  const { device } = await familyWithDevice()
  const r = await issue(device)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(Object.keys(r.json()), ['token'])
  const { token } = r.json()
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  const row = await statusOf(device.device.id)
  assert.equal(row.heartbeat_token_hash.length, 32)
  assert.notEqual(row.heartbeat_token_hash.toString('base64url'), token, 'jamais le jeton en clair')
  const beat = await beatWith(token, { body: { ...OK, batteryPct: 42 } })
  assert.equal(beat.statusCode, 200, beat.body)
  assert.equal((await statusOf(device.device.id)).battery_pct, 42)
  // Avec l'origine de la WebView aussi ; jamais avec une autre origine (page web).
  assert.equal((await beatWith(token, { origin: 'capacitor://localhost' })).statusCode, 200)
  assert.equal((await beatWith(token, { origin: 'https://pirate.test' })).statusCode, 403)
  // La session d'appareil normale garde l'accès au signal.
  assert.equal((await native(ctx.app, 'POST', '/api/device/heartbeat', { token: device.accessToken, body: OK })).statusCode, 200)
  // Émission sans session, ou avec le jeton lui-même : refusée.
  assert.equal((await native(ctx.app, 'POST', '/api/device/heartbeat-token', { body: {} })).statusCode, 401)
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/device/heartbeat-token', payload: {}, headers: { authorization: `Heartbeat ${token}` } })).statusCode, 403)
  assert.equal((await native(ctx.app, 'POST', '/api/device/heartbeat-token', { body: {}, headers: { authorization: `Heartbeat ${token}` } })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/device/heartbeat-token', { token: device.accessToken, body: { childId: device.child.id } })).statusCode, 400)
})

test('nouveau jeton : l’ancien est refusé aussitôt ; jeton inconnu ou mal formé refusé', async () => {
  const { device } = await familyWithDevice()
  const first = (await issue(device)).json().token
  const second = (await issue(device)).json().token
  assert.notEqual(first, second)
  assert.equal((await beatWith(first)).statusCode, 401)
  assert.equal((await beatWith(second)).statusCode, 200)
  assert.equal((await beatWith('A'.repeat(43))).statusCode, 401)
  assert.equal((await beatWith('court')).statusCode, 403, 'schéma illisible : traité comme une requête sans session native')
})

test('téléphone révoqué : jeton refusé et empreinte effacée ; plus d’émission', async () => {
  const { owner, device } = await familyWithDevice()
  const { token } = (await issue(device)).json()
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 200)
  assert.equal((await beatWith(token)).statusCode, 401)
  assert.equal((await statusOf(device.device.id)).heartbeat_token_hash, null)
  // Même si l'empreinte revenait (restauration), revoked_at suffit.
  await ctx.db.query('UPDATE child_devices SET heartbeat_token_hash = sha256($2::text::bytea) WHERE id = $1', [device.device.id, token])
  assert.equal((await beatWith(token)).statusCode, 401)
  assert.equal((await issue(device)).statusCode, 401)
})

test('portée : le jeton n’ouvre aucune autre route d’appareil ni de compte', async () => {
  const { owner, kid, device } = await familyWithDevice()
  const { token } = (await issue(device)).json()
  // Toutes les routes montées sous /api/device, relevées sur l'app elle-même.
  const routes = deviceRoutes(ctx.app)
  const urls = routes.map(([m, u]) => `${m} ${u}`)
  for (const expected of ['GET /api/device/me', 'GET /api/device/config', 'POST /api/device/heartbeat', 'POST /api/device/heartbeat-token', 'POST /api/device/events', 'GET /api/device/messages', 'POST /api/device/messages', 'PUT /api/device/push/token']) {
    assert.ok(urls.includes(expected), `${expected} relevée (${urls.join(', ')})`)
  }
  const PUBLIC = ['POST /api/device/pair', 'POST /api/device/refresh']
  for (const [method, url] of routes) {
    if (url === '/api/device/heartbeat' || PUBLIC.includes(`${method} ${url}`)) continue
    for (const headers of [{ authorization: `Heartbeat ${token}`, origin: 'capacitor://localhost' }, { authorization: `Bearer ${token}`, origin: 'capacitor://localhost' }]) {
      // Le corps est validé avant la session (400 possible) : le jeton ne doit rien donner de
      // plus qu'une requête sans session, et jamais une réponse servie.
      const req = (h) => ctx.app.inject({ method, url, headers: h, ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }) })
      const [r, anonymous] = [await req(headers), await req({ origin: headers.origin })]
      assert.ok([400, 401].includes(r.statusCode), `${method} ${url} avec ${headers.authorization.split(' ')[0]} → ${r.statusCode}`)
      assert.equal(r.statusCode, anonymous.statusCode, `${method} ${url} : comme sans session`)
    }
  }
  // Renouvellement de session : le jeton n'est pas un jeton de renouvellement.
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: token } })).statusCode, 401)
  // Routes de compte : ni en Heartbeat, ni en Bearer.
  for (const auth of [`Heartbeat ${token}`, `Bearer ${token}`]) {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: auth, origin: 'capacitor://localhost' } })
    assert.equal(r.json().user, null, `GET /api/auth/me avec ${auth.split(' ')[0]} : aucun compte`)
  }
  for (const [method, url] of [['DELETE', '/api/auth/me'], ['GET', `/api/children/${kid.id}/status`], ['GET', `/api/children/${kid.id}/devices`]]) {
    for (const auth of [`Heartbeat ${token}`, `Bearer ${token}`]) {
      const r = await ctx.app.inject({ method, url, headers: { authorization: auth, origin: 'capacitor://localhost' } })
      assert.equal(r.statusCode, 401, `${method} ${url} avec ${auth.split(' ')[0]}`)
    }
  }
  // Le parent, lui, voit toujours l'enfant.
  assert.equal((await call(ctx.app, 'GET', `/api/children/${kid.id}/status`, { cookie: owner.cookie })).statusCode, 200)
})

test('cloisonnement A/B : le jeton de A n’écrit que les relevés de A ; émettre pour B ne touche pas A', async () => {
  const a = await familyWithDevice()
  const b = await familyWithDevice()
  const ta = (await issue(a.device)).json().token
  const hashA = (await statusOf(a.device.device.id)).heartbeat_token_hash
  const tb = (await issue(b.device)).json().token
  assert.deepEqual((await statusOf(a.device.device.id)).heartbeat_token_hash, hashA)
  assert.equal((await beatWith(ta, { body: { ...OK, batteryPct: 11 } })).statusCode, 200)
  assert.equal((await statusOf(a.device.device.id)).battery_pct, 11)
  assert.equal((await statusOf(b.device.device.id)).battery_pct, null)
  // Aucun identifiant accepté dans le corps.
  assert.equal((await beatWith(ta, { body: { ...OK, deviceId: b.device.device.id } })).statusCode, 400)
  assert.equal((await beatWith(tb)).statusCode, 200)
  const states = (await call(ctx.app, 'GET', `/api/children/${a.kid.id}/status`, { cookie: b.owner.cookie })).statusCode
  assert.equal(states, 404)
})

test('émission : au plus dix par heure et par téléphone ; journalisée', async () => {
  const { device } = await familyWithDevice()
  const { device: other } = await familyWithDevice()
  for (let i = 0; i < HEARTBEAT_TOKEN_MAX; i++) assert.equal((await issue(device)).statusCode, 200)
  assert.equal((await issue(device)).statusCode, 429)
  assert.equal((await issue(other)).statusCode, 200, 'un autre téléphone n’est pas freiné')
  const { rows: [n] } = await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'device_heartbeat_token' AND target = $1", [device.device.id])
  assert.equal(n.n, HEARTBEAT_TOKEN_MAX)
})

test('rejeu d’un jeton de renouvellement : session fermée et jeton « signal de vie » refusé, effacé', async () => {
  const { device } = await familyWithDevice()
  const { token } = (await issue(device)).json()
  const r1 = (await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })).json()
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })).statusCode, 200)
  // Le successeur écarté réapparaît : deux détenteurs, le jeton a pu fuiter avec la session.
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: r1.refreshToken } })).statusCode, 401)
  assert.equal((await beatWith(token)).statusCode, 401)
  const row = await statusOf(device.device.id)
  assert.equal(row.heartbeat_token_hash, null)
  assert.equal(row.heartbeat_token_expires_at, null)
})

test('validité : 30 jours après l’émission ; échu, refusé ; une nouvelle émission le renouvelle', async () => {
  const { device } = await familyWithDevice()
  const before = Date.now()
  const { token } = (await issue(device)).json()
  const { heartbeat_token_expires_at: until } = await statusOf(device.device.id)
  const days = (until.getTime() - before) / 86_400_000
  assert.ok(days > HEARTBEAT_TOKEN_DAYS - 0.01 && days < HEARTBEAT_TOKEN_DAYS + 0.01, `${days} jours`)
  assert.equal(HEARTBEAT_TOKEN_DAYS, 30)
  // Émis il y a 31 jours : échu.
  await ctx.db.query("UPDATE child_devices SET heartbeat_token_expires_at = now() - interval '1 day' WHERE id = $1", [device.device.id])
  assert.equal((await beatWith(token)).statusCode, 401)
  const fresh = (await issue(device)).json().token
  assert.equal((await beatWith(fresh)).statusCode, 200)
})

test('purge : jeton échu ou sans session d’appareil renouvelable effacé ; jeton valable gardé', async () => {
  const expired = (await familyWithDevice()).device
  const orphan = (await familyWithDevice()).device
  const kept = (await familyWithDevice()).device
  for (const d of [expired, orphan, kept]) assert.equal((await issue(d)).statusCode, 200)
  await ctx.db.query("UPDATE child_devices SET heartbeat_token_expires_at = now() - interval '1 minute' WHERE id = $1", [expired.device.id])
  // Session du téléphone morte (plus renouvelable) : il ne pourra plus jamais émettre.
  await ctx.db.query("UPDATE device_sessions SET expires_at = now() - interval '2 days', refresh_expires_at = now() - interval '1 day' WHERE device_id = $1", [orphan.device.id])
  await ctx.db.query("UPDATE job_runs SET started_at = NULL WHERE job = 'retention'")
  const result = await runRetention(ctx.db, { info() {}, error() {} })
  assert.ok(result.heartbeatTokens >= 2, JSON.stringify(result))
  for (const d of [expired, orphan]) {
    const row = await statusOf(d.device.id)
    assert.equal(row.heartbeat_token_hash, null)
    assert.equal(row.heartbeat_token_expires_at, null)
  }
  const row = await statusOf(kept.device.id)
  assert.equal(row.heartbeat_token_hash.length, 32)
  assert.ok(row.heartbeat_token_expires_at > new Date())
})
