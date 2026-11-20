// Back-office de l'équipe, tranche 2 (NAR-199) : désactiver ou réactiver un compte, révoquer
// un téléphone. Droits (admin MFA seulement), sessions refusées (cookie, Bearer, renouvellement
// natif), connexion d'un compte désactivé (adresse et numéro) identique à un mauvais mot de
// passe, gardes (soi-même, dernier administrateur actif), audit, champs inconnus, rôle SQL.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { startDb, startApp, call, native, newUser, cookieOf, ORIGIN, NATIVE } from './helpers.js'
import { createPool } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', REGISTRATIONS_PER_HOUR: '100000', SMS_PER_HOUR: '100000', SMS_PER_IP_PER_HOUR: '100000', SMS_PER_NUMBER_PER_HOUR: '1000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const OK_BEAT = { batteryPct: 80, charging: false, network: 'wifi', simState: 'ready', background: true }
const fcmToken = () => `fcm-${randomUUID()}:APA91b${'x'.repeat(100)}`
const post = (app, u, url, body) => call(app, 'POST', url, { cookie: u?.cookie, ...(body !== undefined ? { body } : {}) })
const disable = (u, id, body) => post(ctx.app, u, `/api/admin/users/${id}/disable`, body)
const enable = (u, id, body) => post(ctx.app, u, `/api/admin/users/${id}/enable`, body)
const revoke = (u, id, body) => post(ctx.app, u, `/api/admin/devices/${id}/revoke`, body)
// Route protégée quelconque : 404 (pas de famille) avec une session, 401 sans.
const sessionOf = (u) => call(ctx.app, 'GET', '/api/families/me', { cookie: u.cookie })
const auditOf = async (action, target) => (await ctx.db.query(
  'SELECT actor_id, target, details FROM audit_log WHERE action = $1 AND target = $2 ORDER BY id', [action, target])).rows
const beat = (token) => ctx.app.inject({ method: 'POST', url: '/api/device/heartbeat', payload: OK_BEAT, headers: { authorization: `Heartbeat ${token}` } })

async function nativeLogin(u, extra = {}) {
  const r = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: u.email, password: u.password, ...extra } })
  assert.equal(r.statusCode, 200, r.body)
  return r.json()
}

async function familyWithDevice() {
  const owner = await newUser(ctx)
  assert.equal((await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })).statusCode, 201)
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel' } })
  assert.equal(res.statusCode, 201, res.body)
  return { owner, kid, device: res.json() }
}

// Compte par numéro (NAR-136), numéro confirmé directement en base (le parcours SMS est
// couvert par phone-auth.test.js).
let phones = 0
async function phoneUser() {
  const phone = `+26132${String(process.pid % 1000).padStart(3, '0')}${String(++phones).padStart(4, '0')}`
  const password = 'tsara ny andro anio maraina'
  assert.equal((await call(ctx.app, 'POST', '/api/auth/phone/register', { body: { phone, name: 'Rasoa', password, consent: true } })).statusCode, 202)
  let id
  for (let i = 0; i < 100 && !id; i++) {
    id = (await ctx.db.query('UPDATE users SET phone_verified_at = now() WHERE phone = $1 RETURNING id', [phone])).rows[0]?.id
    if (!id) await new Promise((r) => setTimeout(r, 20))
  }
  assert.ok(id, 'compte à numéro créé')
  const login = await call(ctx.app, 'POST', '/api/auth/login', { body: { phone, password } })
  assert.equal(login.statusCode, 200, login.body)
  return { id, phone, password, cookie: cookieOf(login) }
}

test('matrice : 401 sans session, 403 pour un parent (cookie et Bearer), admin sans MFA vérifiée 401, admin MFA 200', async () => {
  const parent = await newUser(ctx)
  const parentBearer = (await nativeLogin(parent)).accessToken
  const admin = await newUser(ctx, { admin: true })
  const target = await newUser(ctx)
  const { device } = await familyWithDevice()
  const urls = [`/api/admin/users/${target.id}/disable`, `/api/admin/users/${target.id}/enable`, `/api/admin/devices/${device.device.id}/revoke`]
  for (const url of urls) {
    assert.equal((await post(ctx.app, null, url)).statusCode, 401, url)
    assert.equal((await post(ctx.app, parent, url)).statusCode, 403, url)
    assert.equal((await native(ctx.app, 'POST', url, { token: parentBearer })).statusCode, 403, url)
    // Un parent n'a rien changé.
    assert.equal((await ctx.db.query('SELECT disabled_at FROM users WHERE id = $1', [target.id])).rows[0].disabled_at, null)
    assert.equal((await ctx.db.query('SELECT revoked_at FROM child_devices WHERE id = $1', [device.device.id])).rows[0].revoked_at, null)
  }
  // Un administrateur dont la MFA n'a pas été vérifiée dans la session n'a pas de session.
  const unverified = await newUser(ctx, { admin: true })
  await ctx.db.query('UPDATE sessions SET mfa_verified_at = NULL WHERE user_id = $1', [unverified.id])
  for (const url of urls) assert.equal((await post(ctx.app, unverified, url)).statusCode, 401, url)
  // Les comptes admin se connectent par le web (MFA) : jamais par Bearer, donc rien à tester là.
  for (const url of urls) assert.equal((await post(ctx.app, admin, url)).statusCode, 200, url)
})

test('désactivation : sessions cookie et Bearer refusées dès la requête suivante, renouvellement natif refusé, jetons push effacés, audit', async () => {
  const admin = await newUser(ctx, { admin: true })
  const u = await newUser(ctx)
  const nat = await nativeLogin(u)
  assert.equal((await sessionOf(u)).statusCode, 404)
  assert.equal((await native(ctx.app, 'GET', '/api/families/me', { token: nat.accessToken })).statusCode, 404)
  assert.equal((await call(ctx.app, 'PUT', '/api/push/token', { cookie: u.cookie, body: { token: fcmToken(), platform: 'android', lang: 'fr' } })).statusCode, 200)
  assert.equal((await native(ctx.app, 'PUT', '/api/push/token', { token: nat.accessToken, body: { token: fcmToken(), platform: 'ios', lang: 'en' } })).statusCode, 200)
  const pushCount = async () => (await ctx.db.query('SELECT count(*)::int AS n FROM push_tokens t JOIN sessions s ON s.id = t.session_id WHERE s.user_id = $1', [u.id])).rows[0].n
  assert.equal(await pushCount(), 2)
  const pushTotal = async () => (await ctx.db.query('SELECT count(*)::int AS n FROM push_tokens')).rows[0].n
  const before = await pushTotal()

  const r = await disable(admin, u.id)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json(), { ok: true })
  assert.equal((await sessionOf(u)).statusCode, 401)
  assert.equal((await native(ctx.app, 'GET', '/api/families/me', { token: nat.accessToken })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: nat.refreshToken } })).statusCode, 401)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [u.id])).rows[0].n, 0)
  assert.equal(await pushTotal(), before - 2, 'les deux jetons push du compte, par cascade')
  const lines = await auditOf('account_disabled', u.id)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].actor_id, admin.id)
  // Listé désactivé pour l'équipe.
  const listed = (await call(ctx.app, 'GET', '/api/admin/users', { cookie: admin.cookie })).json().find((x) => x.id === u.id)
  assert.ok(listed.disabled_at)
  // Déjà désactivé : 200, rien d'écrit, aucune seconde ligne d'audit.
  assert.equal((await disable(admin, u.id)).statusCode, 200)
  assert.equal((await auditOf('account_disabled', u.id)).length, 1)

  // Réactivé : il peut se reconnecter ; aucune session ancienne ne revient.
  assert.equal((await enable(admin, u.id)).statusCode, 200)
  assert.equal((await sessionOf(u)).statusCode, 401)
  const again = await call(ctx.app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
  assert.equal(again.statusCode, 200, again.body)
  assert.equal((await sessionOf({ cookie: cookieOf(again) })).statusCode, 404)
  const enabled = await auditOf('account_enabled', u.id)
  assert.equal(enabled.length, 1)
  assert.equal(enabled[0].actor_id, admin.id)
  assert.equal((await enable(admin, u.id)).statusCode, 200)
  assert.equal((await auditOf('account_enabled', u.id)).length, 1, 'déjà actif : aucune ligne de plus')
})

test('SESSION_RULE seule : un compte désactivé en base garde ses sessions mais aucune n’est acceptée (cookie, Bearer, renouvellement)', async () => {
  const u = await newUser(ctx)
  const nat = await nativeLogin(u)
  await ctx.db.query('UPDATE users SET disabled_at = now() WHERE id = $1', [u.id])
  assert.equal((await sessionOf(u)).statusCode, 401)
  assert.equal((await native(ctx.app, 'GET', '/api/families/me', { token: nat.accessToken })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: nat.refreshToken } })).statusCode, 401)
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user, null)
  // C'est bien la règle : la colonne effacée, la même session cookie repasse.
  await ctx.db.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [u.id])
  assert.equal((await sessionOf(u)).statusCode, 404)
})

test('connexion d’un compte désactivé (adresse et numéro, web et natif) : le 401 générique d’un mauvais mot de passe', async () => {
  const admin = await newUser(ctx, { admin: true })
  const byEmail = await newUser(ctx)
  const byPhone = await phoneUser()
  const wrongEmail = await call(ctx.app, 'POST', '/api/auth/login', { body: { email: byEmail.email, password: 'pas le bon mot de passe du tout' } })
  const wrongPhone = await call(ctx.app, 'POST', '/api/auth/login', { body: { phone: byPhone.phone, password: 'pas le bon mot de passe du tout' } })
  const wrongEmailNative = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: byEmail.email, password: 'pas le bon mot de passe du tout' } })
  const wrongPhoneNative = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { phone: byPhone.phone, password: 'pas le bon mot de passe du tout' } })
  for (const r of [wrongEmail, wrongPhone, wrongEmailNative, wrongPhoneNative]) assert.equal(r.statusCode, 401)
  assert.equal((await disable(admin, byEmail.id)).statusCode, 200)
  assert.equal((await disable(admin, byPhone.id)).statusCode, 200)
  const cases = [
    [await call(ctx.app, 'POST', '/api/auth/login', { body: { email: byEmail.email, password: byEmail.password } }), wrongEmail],
    [await call(ctx.app, 'POST', '/api/auth/login', { body: { phone: byPhone.phone, password: byPhone.password } }), wrongPhone],
    [await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: byEmail.email, password: byEmail.password } }), wrongEmailNative],
    [await native(ctx.app, 'POST', '/api/auth/native/login', { body: { phone: byPhone.phone, password: byPhone.password } }), wrongPhoneNative]
  ]
  for (const [right, wrong] of cases) {
    assert.equal(right.statusCode, 401, right.body)
    assert.deepEqual(right.json(), wrong.json())
    assert.equal(right.headers['set-cookie'], undefined, 'aucun cookie de session')
  }
  assert.match(cases[0][0].json().error, /Email ou mot de passe incorrect/)
  assert.match(cases[1][0].json().error, /Numéro ou mot de passe incorrect/)
  // Réactivé : le bon mot de passe ouvre de nouveau une session (la garde n'est pas verrouillée
  // par ces quelques essais).
  assert.equal((await enable(admin, byPhone.id)).statusCode, 200)
  assert.equal((await call(ctx.app, 'POST', '/api/auth/login', { body: { phone: byPhone.phone, password: byPhone.password } })).statusCode, 200)
  // L'équipe ne voit jamais le numéro, même après ces actions.
  const users = await call(ctx.app, 'GET', '/api/admin/users', { cookie: admin.cookie })
  assert.ok(!users.body.includes(byPhone.phone.slice(4)), 'numéro absent de la liste des comptes')
  const audit = await call(ctx.app, 'GET', '/api/admin/audit', { cookie: admin.cookie })
  assert.ok(!audit.body.includes(byPhone.phone.slice(4)), 'numéro absent du journal')
})

test('garde : un administrateur ne désactive pas son propre compte', async () => {
  const admin = await newUser(ctx, { admin: true })
  const r = await disable(admin, admin.id)
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'self_disable')
  assert.equal((await disable(admin, admin.id.toUpperCase())).statusCode, 409, 'même identifiant en majuscules')
  assert.equal((await ctx.db.query('SELECT disabled_at FROM users WHERE id = $1', [admin.id])).rows[0].disabled_at, null)
  assert.equal((await sessionOf(admin)).statusCode, 404, 'session intacte')
  assert.equal((await auditOf('account_disabled', admin.id)).length, 0)
})

test('identifiant inconnu ou mal formé → 404 ; paramètre, champ inconnu ou corps non objet → 400, rien d’écrit', async () => {
  const admin = await newUser(ctx, { admin: true })
  const target = await newUser(ctx)
  const { device } = await familyWithDevice()
  for (const id of [randomUUID(), 'pas-un-uuid', '1']) {
    assert.equal((await disable(admin, id)).statusCode, 404, id)
    assert.equal((await enable(admin, id)).statusCode, 404, id)
    assert.equal((await revoke(admin, id)).statusCode, 404, id)
  }
  const urls = [`/api/admin/users/${target.id}/disable`, `/api/admin/users/${target.id}/enable`, `/api/admin/devices/${device.device.id}/revoke`]
  for (const url of urls) {
    for (const bad of [{ disabled: true }, { is_admin: true }, { reason: 'x' }, [], ['x']]) {
      assert.equal((await post(ctx.app, admin, url, bad)).statusCode, 400, `${url} ${JSON.stringify(bad)}`)
    }
    // Corps JSON qui n'est pas un objet, ou corps qui n'est pas du JSON.
    assert.equal((await call(ctx.app, 'POST', url, { cookie: admin.cookie, body: '"texte"', headers: { 'content-type': 'application/json' } })).statusCode, 400, url)
    assert.equal((await post(ctx.app, admin, url, 'texte')).statusCode, 415, url)
    assert.equal((await post(ctx.app, admin, `${url}?force=1`)).statusCode, 400, url)
  }
  assert.equal((await ctx.db.query('SELECT disabled_at FROM users WHERE id = $1', [target.id])).rows[0].disabled_at, null)
  assert.equal((await ctx.db.query('SELECT revoked_at FROM child_devices WHERE id = $1', [device.device.id])).rows[0].revoked_at, null)
  // Corps vide `{}` accepté.
  assert.equal((await post(ctx.app, admin, urls[0], {})).statusCode, 200)
})

test('révocation par l’équipe : jeton d’appareil, renouvellement et signal de vie refusés, jetons push effacés, audit ; seconde fois 404', async () => {
  const admin = await newUser(ctx, { admin: true })
  const { device } = await familyWithDevice()
  const id = device.device.id
  const hb = await native(ctx.app, 'POST', '/api/device/heartbeat-token', { token: device.accessToken, body: {} })
  assert.equal(hb.statusCode, 200, hb.body)
  assert.equal((await beat(hb.json().token)).statusCode, 200)
  assert.equal((await native(ctx.app, 'PUT', '/api/device/push/token', { token: device.accessToken, body: { token: fcmToken(), platform: 'android' } })).statusCode, 200)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: device.accessToken })).statusCode, 200)

  const r = await revoke(admin, id)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json(), { ok: true })
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: device.accessToken })).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/device/refresh', { body: { refreshToken: device.refreshToken } })).statusCode, 401)
  assert.equal((await beat(hb.json().token)).statusCode, 401)
  const { rows: [row] } = await ctx.db.query('SELECT revoked_at, heartbeat_token_hash FROM child_devices WHERE id = $1', [id])
  assert.ok(row.revoked_at)
  assert.equal(row.heartbeat_token_hash, null)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM push_tokens WHERE device_id = $1', [id])).rows[0].n, 0)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM device_sessions WHERE device_id = $1', [id])).rows[0].n, 0)
  const lines = await auditOf('device_revoked', id)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].actor_id, admin.id)
  assert.deepEqual(lines[0].details, { by: 'admin' })
  const state = (await call(ctx.app, 'GET', '/api/admin/devices?limit=100', { cookie: admin.cookie })).json().items.find((d) => d.id === id).state
  assert.equal(state, 'revoked')
  assert.equal((await revoke(admin, id)).statusCode, 404, 'déjà révoqué')
  assert.equal((await auditOf('device_revoked', id)).length, 1)
})

test('la révocation par la famille passe par la même fonction : même effet et même audit, sans détail', async () => {
  const { owner, device } = await familyWithDevice()
  const hb = (await native(ctx.app, 'POST', '/api/device/heartbeat-token', { token: device.accessToken, body: {} })).json().token
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 200)
  assert.equal((await native(ctx.app, 'GET', '/api/device/me', { token: device.accessToken })).statusCode, 401)
  assert.equal((await beat(hb)).statusCode, 401)
  const lines = await auditOf('device_revoked', device.device.id)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].actor_id, owner.id)
  assert.equal(lines[0].details, null)
  // Le téléphone d'une autre famille reste hors de portée d'un gestionnaire.
  const other = await familyWithDevice()
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${other.device.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 404)
})

test('rôle SQL restreint app_runtime : désactiver, réactiver, révoquer passent ; rien d’autre sur users', async () => {
  const sql = (await readFile(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8')).replace(":'runtime_password'", "'runtime-test-only'")
  await ctx.db.query(sql)
  // La migration accorde le même droit sur une base dont le rôle existe déjà.
  await ctx.db.query('REVOKE UPDATE (disabled_at) ON users FROM app_runtime')
  await ctx.db.query(await readFile(new URL('../src/migrations/028_account_disable.sql', import.meta.url), 'utf8').then((s) => s.replace('ALTER TABLE users ADD COLUMN disabled_at timestamptz;', '')))
  const { rows } = await ctx.db.query(
    `SELECT column_name FROM information_schema.column_privileges
      WHERE grantee = 'app_runtime' AND table_name = 'users' AND privilege_type = 'UPDATE' ORDER BY column_name`)
  const cols = rows.map((r) => r.column_name)
  assert.ok(cols.includes('disabled_at'))
  for (const c of ['is_admin', 'email', 'phone', 'id', 'created_at']) assert.ok(!cols.includes(c), c)

  const admin = await newUser(ctx, { admin: true })
  const target = await newUser(ctx)
  const { device } = await familyWithDevice()
  const url = new URL(dbh.url); url.username = 'app_runtime'; url.password = 'runtime-test-only'
  const pool = createPool(url.toString())
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), APP_ORIGIN: ORIGIN, NATIVE_ORIGINS: `${NATIVE},https://localhost`, RATE_LIMIT_IP: '10000', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), ...APK })
  const app = await buildApp({ config, db: pool, mailer: { async send() {} }, logger: false })
  try {
    assert.equal((await pool.query('SELECT current_user AS u')).rows[0].u, 'app_runtime')
    assert.equal((await post(app, admin, `/api/admin/users/${target.id}/disable`)).statusCode, 200)
    assert.equal((await call(app, 'GET', '/api/families/me', { cookie: target.cookie })).statusCode, 401)
    assert.equal((await post(app, admin, `/api/admin/users/${target.id}/enable`)).statusCode, 200)
    assert.equal((await post(app, admin, `/api/admin/devices/${device.device.id}/revoke`)).statusCode, 200)
    assert.equal((await call(app, 'GET', '/api/admin/users', { cookie: admin.cookie })).statusCode, 200)
    await assert.rejects(pool.query('UPDATE users SET is_admin = false'), /permission denied/)
    await assert.rejects(pool.query("UPDATE users SET email = 'pirate@exemple.fr'"), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM audit_log'), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM child_devices'), /permission denied/)
  } finally { await app.close(); await pool.end() }
})

// En dernier : met tous les autres administrateurs hors service le temps du test, puis les rend.
test('dernier administrateur actif : jamais désactivé (requête en vol), jamais supprimé quand l’autre est désactivé', async () => {
  const a = await newUser(ctx, { admin: true })
  const b = await newUser(ctx, { admin: true })
  const { rows: others } = await ctx.db.query('UPDATE users SET disabled_at = now() WHERE is_admin AND disabled_at IS NULL AND id NOT IN ($1, $2) RETURNING id', [a.id, b.id])
  try {
    // B désactive A pendant que A désactive B : la requête de B a passé le contrôle de session,
    // puis attend le verrou de la ligne de A ; A (ici, une transaction du test) désactive B et
    // valide. B relit alors la base : A est le dernier actif → 409, A reste actif.
    const conn = await ctx.db.connect()
    let inFlight
    try {
      await conn.query('BEGIN')
      await conn.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [a.id])
      inFlight = disable(b, a.id)
      let waiting = false
      for (let i = 0; i < 200 && !waiting; i++) {
        waiting = (await ctx.db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT id, is_admin, disabled_at FROM users%'")).rows.length > 0
        if (!waiting) await new Promise((r) => setTimeout(r, 10))
      }
      assert.ok(waiting, 'la requête de B attend le verrou de A')
      await conn.query('UPDATE users SET disabled_at = now() WHERE id = $1', [b.id])
      await conn.query('COMMIT')
    } finally { conn.release() }
    const r = await inFlight
    assert.equal(r.statusCode, 409, r.body)
    assert.equal(r.json().code, 'last_admin')
    assert.equal((await ctx.db.query('SELECT disabled_at FROM users WHERE id = $1', [a.id])).rows[0].disabled_at, null)
    assert.equal((await sessionOf(a)).statusCode, 404, 'A garde sa session')
    assert.equal((await auditOf('account_disabled', a.id)).length, 0)
    // Le seul autre administrateur est désactivé : A ne peut pas non plus supprimer son compte.
    const del = await call(ctx.app, 'DELETE', '/api/auth/me', { cookie: a.cookie, body: { password: a.password } })
    assert.equal(del.statusCode, 409, del.body)
    assert.equal(del.json().code, 'last_admin')
    // B réactivé : A peut désactiver B (B reste actif ailleurs, A aussi).
    assert.equal((await enable(a, b.id)).statusCode, 200)
    assert.equal((await disable(a, b.id)).statusCode, 200)
    assert.equal((await enable(a, b.id)).statusCode, 200)
  } finally {
    await ctx.db.query('UPDATE users SET disabled_at = NULL WHERE id = ANY($1::uuid[])', [others.map((o) => o.id)])
  }
})
