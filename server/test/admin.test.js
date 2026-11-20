// Back-office de l'équipe (NAR-144, tranche 1 : listes et statistiques en lecture seule).
// Droits (admin MFA seulement), pagination, état des téléphones, statistiques anonymes,
// et inspection de TOUTE réponse admin : ni prénom, ni numéro, ni nom de famille, ni
// position, ni journal d'appels, ni hachage du code parent.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { startDb, startApp, call, native, newUser, ORIGIN, NATIVE } from './helpers.js'
import { createPool } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const ROUTES = ['/api/admin/users', '/api/admin/audit', '/api/admin/families', '/api/admin/devices', '/api/admin/stats']
const get = (u, url) => call(ctx.app, 'GET', url, { cookie: u?.cookie })
const OK_BEAT = { batteryPct: 80, charging: false, network: 'wifi', simState: 'ready', background: true }

// Famille dont le nom contient le prénom de l'enfant (texte libre de la famille), enfant avec
// numéro, contact nommé, code parent, téléphone appairé qui envoie un signal et un appel.
const SECRET = { child: 'Mirantsoazy', family: 'Famille Mirantsoazy Rakotobe', contact: 'Dadabe Ravoninahitra', childPhone: '+261341239876', contactPhone: '+261331117788' }
async function seededFamily() {
  const owner = await newUser(ctx)
  assert.equal((await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: SECRET.family } })).statusCode, 201)
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: SECRET.child, phone: '034 12 398 76' } })).json()
  assert.equal(kid.phone, SECRET.childPhone)
  const contact = await call(ctx.app, 'POST', `/api/children/${kid.id}/contacts`, { cookie: owner.cookie, body: { name: SECRET.contact, phone: '033 11 177 88' } })
  assert.equal(contact.statusCode, 201, contact.body)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/parent-code`, { cookie: owner.cookie, body: { code: '418529' } })).statusCode, 200)
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const pair = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Itel A70', osVersion: '13', appVersion: '1.4.2' } })
  assert.equal(pair.statusCode, 201, pair.body)
  const device = pair.json()
  assert.equal((await native(ctx.app, 'POST', '/api/device/heartbeat', { token: device.accessToken, body: OK_BEAT })).statusCode, 200)
  const ev = await native(ctx.app, 'POST', '/api/device/events', {
    token: device.accessToken,
    body: { events: [{ id: randomUUID(), kind: 'call_out', contactId: contact.json().id, name: SECRET.contact, phone: SECRET.contactPhone, startedAt: new Date().toISOString(), durationS: 42 }] }
  })
  assert.equal(ev.statusCode, 200, ev.body)
  const { rows: [{ parent_code_hash: codeHash, family_id: familyId }] } = await ctx.db.query('SELECT parent_code_hash, family_id FROM children WHERE id = $1', [kid.id])
  return { owner, kid, device, familyId, codeHash }
}

test('chaque route admin : 401 sans session, 403 pour un parent (cookie et Bearer), 200 pour un admin MFA', async () => {
  const parent = await newUser(ctx)
  const admin = await newUser(ctx, { admin: true })
  const nativeLogin = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: parent.email, password: parent.password } })
  assert.equal(nativeLogin.statusCode, 200, nativeLogin.body)
  for (const url of ROUTES) {
    assert.equal((await get(null, url)).statusCode, 401, url)
    assert.equal((await get(parent, url)).statusCode, 403, url)
    assert.equal((await native(ctx.app, 'GET', url, { token: nativeLogin.json().accessToken })).statusCode, 403, url)
    assert.equal((await get(admin, url)).statusCode, 200, url)
  }
  // Un admin dont la MFA n'a pas été vérifiée dans la session n'a pas de session du tout.
  await ctx.db.query('UPDATE sessions SET mfa_verified_at = NULL WHERE user_id = $1', [admin.id])
  for (const url of ROUTES) assert.equal((await get(admin, url)).statusCode, 401, url)
})

test('aucune réponse admin ne contient prénom, nom de famille, numéro, contact, appel, position ni code parent', async () => {
  const seeded = await seededFamily()
  await seededFamily() // seconde famille et second téléphone : une seconde page à inspecter
  const admin = await newUser(ctx, { admin: true })
  const forbiddenValues = [
    SECRET.child, SECRET.family, SECRET.contact, SECRET.childPhone, SECRET.contactPhone,
    // Formes nationales et chiffres seuls des numéros, et le hachage du code parent.
    '0341239876', '341239876', '0331117788', '331117788', seeded.codeHash
  ]
  // Clés interdites partout ; `name` seulement hors de la liste des comptes (nom du compte,
  // déjà montré à l'équipe avant NAR-144).
  const forbiddenKey = /phone|first_?name|_enc$|hash|token|lat(itude)?$|^lon(gitude)?$|^lng$|position|location|geo|call|event|journal|contact|battery|parent_?code|^child$/i
  const inspect = (url, value, path = '') => {
    if (Array.isArray(value)) return value.forEach((v, i) => inspect(url, v, `${path}[${i}]`))
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        assert.ok(!forbiddenKey.test(k), `${url} : clé interdite ${path}.${k}`)
        if (k === 'name') assert.ok(url === '/api/admin/users', `${url} : clé interdite ${path}.name`)
        inspect(url, v, `${path}.${k}`)
      }
      return
    }
    if (typeof value === 'string') for (const bad of forbiddenValues) assert.ok(!value.includes(bad), `${url} : valeur interdite à ${path}`)
  }
  // Chaque page des listes, la première comme les suivantes (curseur `before`).
  const pages = [...ROUTES, '/api/admin/families?limit=100', '/api/admin/devices?limit=100']
  for (const path of ['/api/admin/families', '/api/admin/devices']) {
    let next = (await get(admin, `${path}?limit=1`)).json().next
    assert.ok(next, `${path} : au moins une seconde page`)
    while (next) {
      const url = `${path}?limit=1&before=${encodeURIComponent(next)}`
      pages.push(url)
      next = (await get(admin, url)).json().next
    }
  }
  for (const url of pages) {
    const r = await get(admin, url)
    assert.equal(r.statusCode, 200, url)
    // Corps brut aussi : rien d'interdit, même hors d'une valeur de chaîne.
    for (const bad of forbiddenValues) assert.ok(!r.body.includes(bad), `${url} : ${bad === seeded.codeHash ? 'hachage du code parent' : 'donnée interdite'} dans la réponse`)
    inspect(url, r.json())
  }
  // La famille et son téléphone sont bien listés (le test n'est pas vide).
  const fam = (await get(admin, '/api/admin/families?limit=100')).json().items.find((f) => f.id === seeded.familyId)
  assert.deepEqual(Object.keys(fam).sort(), ['children', 'createdAt', 'devices', 'id', 'members'])
  assert.deepEqual([fam.members, fam.children, fam.devices], [1, 1, 1])
  const dev = (await get(admin, '/api/admin/devices?limit=100')).json().items.find((d) => d.id === seeded.device.device.id)
  assert.deepEqual(Object.keys(dev).sort(), ['appVersion', 'createdAt', 'familyId', 'id', 'lastSeenAt', 'model', 'osVersion', 'revokedAt', 'state', 'statusAt'])
  assert.equal(dev.model, 'Itel A70')
  assert.equal(dev.appVersion, '1.4.2')
  assert.equal(dev.familyId, seeded.familyId)
  assert.equal(dev.state, 'active')
  assert.ok(dev.statusAt, 'dernier signal présent')
})

test('pagination : limit 1 à 100, curseur sans doublon ni trou, paramètre inconnu ou mal formé → 400', async () => {
  const admin = await newUser(ctx, { admin: true })
  for (let i = 0; i < 3; i++) {
    const u = await newUser(ctx)
    await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: `Famille ${i}` } })
  }
  // Égalité de date de création, à la microseconde (même transaction, insertion en lot) :
  // le départage par id ne saute ni ne double aucune ligne, et le curseur garde la microseconde.
  await ctx.db.query("UPDATE families SET created_at = '2030-01-01T00:00:00.123456Z' WHERE id IN (SELECT id FROM families ORDER BY created_at DESC LIMIT 3)")
  const all = (await get(admin, '/api/admin/families?limit=100')).json().items.map((f) => f.id)
  assert.ok(all.length >= 3)
  const seen = []
  let next = null
  do {
    const r = await get(admin, `/api/admin/families?limit=1${next ? `&before=${encodeURIComponent(next)}` : ''}`)
    assert.equal(r.statusCode, 200, r.body)
    assert.ok(r.json().items.length <= 1)
    seen.push(...r.json().items.map((f) => f.id))
    next = r.json().next
    if (seen.length === 1) assert.match(next, /^2030-01-01T00:00:00\.123456Z_/)
  } while (next)
  assert.deepEqual(seen, all)
  const id = randomUUID()
  const tampered = ['hier', '2026-01-01T00:00:00Z_pasunuuid', `2026-02-30T00:00:00Z_${id}`, `0000-01-01T00:00:00Z_${id}`, `2026-01-01T24:00:00Z_${id}`,
    `2026-01-01T00:00:00.1234567Z_${id}`, `2026-01-01 00:00:00Z_${id}`, `2026-01-01T00:00:00+03:00_${id}`, `2026-01-01T00:00:00Z_${id}_x`, `1_${id}`]
  for (const q of ['limit=0', 'limit=101', 'limit=abc', 'limit=-1', 'limit=1&limit=2', 'family=x', 'order=name', ...tampered.map((c) => `before=${encodeURIComponent(c)}`)]) {
    assert.equal((await get(admin, `/api/admin/families?${q}`)).statusCode, 400, q)
    assert.equal((await get(admin, `/api/admin/devices?${q}`)).statusCode, 400, q)
  }
  assert.equal((await get(admin, `/api/admin/families?before=${encodeURIComponent(`2026-01-01T00:00:00.5Z_${id}`)}`)).statusCode, 200)
  assert.equal((await get(admin, '/api/admin/stats?limit=1')).statusCode, 400)
})

test('curseur indépendant du fuseau de la session PostgreSQL (passage à l’heure d’été, microseconde)', async () => {
  const admin = await newUser(ctx, { admin: true })
  for (let i = 0; i < 3; i++) {
    const u = await newUser(ctx)
    await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: `Famille fuseau ${i}` } })
  }
  // 02:30 à New York le 9 mars 2031 n'existe pas (heure d'été) : le curseur reste en UTC.
  const AT = '2031-03-09T07:30:00.654321Z'
  await ctx.db.query('UPDATE families SET created_at = $1 WHERE id IN (SELECT id FROM families ORDER BY created_at DESC LIMIT 3)', [AT])
  const pool = new pg.Pool({ connectionString: dbh.url, max: 2, options: '-c TimeZone=America/New_York' })
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: dbh.url, APP_ORIGIN: ORIGIN, NATIVE_ORIGINS: `${NATIVE},https://localhost`, RATE_LIMIT_IP: '10000', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), ...APK })
  const app = await buildApp({ config, db: pool, mailer: { async send() {} }, logger: false })
  try {
    assert.equal((await pool.query('SHOW TimeZone')).rows[0].TimeZone, 'America/New_York')
    const all = (await call(app, 'GET', '/api/admin/families?limit=100', { cookie: admin.cookie })).json().items.map((f) => f.id)
    const seen = []
    let next = null
    do {
      const r = await call(app, 'GET', `/api/admin/families?limit=1${next ? `&before=${encodeURIComponent(next)}` : ''}`, { cookie: admin.cookie })
      assert.equal(r.statusCode, 200, r.body)
      seen.push(...r.json().items.map((f) => f.id))
      next = r.json().next
      if (seen.length <= 3) assert.ok(next.startsWith(`${AT}_`), next)
    } while (next)
    assert.deepEqual(seen, all)
  } finally { await app.close(); await pool.end() }
})

test('état des téléphones et statistiques : actif, silencieux (signal en arrière-plan trop vieux), révoqué', async () => {
  const admin = await newUser(ctx, { admin: true })
  const stats = async () => (await get(admin, '/api/admin/stats')).json()
  const stateOf = async (id) => (await get(admin, '/api/admin/devices?limit=100')).json().items.find((d) => d.id === id)?.state
  const s0 = await stats()
  assert.deepEqual(Object.keys(s0).sort(), ['activeDevices', 'children', 'devices', 'devicesSignal24h', 'families', 'silentDevices', 'sosThisMonth', 'sosTracked'])
  assert.equal(s0.sosThisMonth, 0)
  assert.equal(s0.sosTracked, false)
  const { owner, device } = await seededFamily()
  const id = device.device.id
  const s1 = await stats()
  assert.equal(s1.families, s0.families + 1)
  assert.equal(s1.children, s0.children + 1)
  assert.equal(s1.devices, s0.devices + 1)
  assert.equal(s1.activeDevices, s0.activeDevices + 1)
  assert.equal(s1.devicesSignal24h, s0.devicesSignal24h + 1)
  // Dernier signal en arrière-plan vieux de 61 minutes : silencieux.
  await ctx.db.query("UPDATE child_devices SET status_at = now() - interval '61 minutes' WHERE id = $1", [id])
  assert.equal(await stateOf(id), 'silent')
  const s2 = await stats()
  assert.equal(s2.silentDevices, s0.silentDevices + 1)
  assert.equal(s2.activeDevices, s0.activeDevices)
  // Révoqué par la famille : plus compté parmi les téléphones.
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${id}/revoke`, { cookie: owner.cookie })).statusCode, 200)
  assert.equal(await stateOf(id), 'revoked')
  const s3 = await stats()
  assert.equal(s3.devices, s0.devices)
  assert.equal(s3.silentDevices, s0.silentDevices)
})

test('les routes admin de la tranche 1 n’acceptent aucune méthode d’écriture', async () => {
  const admin = await newUser(ctx, { admin: true })
  for (const url of ['/api/admin/families', '/api/admin/devices', '/api/admin/stats']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await call(ctx.app, method, url, { cookie: admin.cookie, body: {} })).statusCode, 404, `${method} ${url}`)
    }
  }
})

test('routes admin sous le rôle SQL restreint app_runtime (droits SELECT de 003, 005 et 007)', async () => {
  const sql = (await readFile(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8')).replace(":'runtime_password'", "'runtime-test-only'")
  await ctx.db.query(sql)
  await seededFamily()
  const admin = await newUser(ctx, { admin: true })
  const url = new URL(dbh.url); url.username = 'app_runtime'; url.password = 'runtime-test-only'
  const pool = createPool(url.toString())
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), APP_ORIGIN: ORIGIN, NATIVE_ORIGINS: `${NATIVE},https://localhost`, RATE_LIMIT_IP: '10000', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), ...APK })
  const app = await buildApp({ config, db: pool, mailer: { async send() {} }, logger: false })
  try {
    assert.equal((await pool.query('SELECT current_user AS u')).rows[0].u, 'app_runtime')
    for (const path of ROUTES) {
      const r = await call(app, 'GET', path, { cookie: admin.cookie })
      assert.equal(r.statusCode, 200, `${path} ${r.body}`)
    }
    for (const path of ['/api/admin/families', '/api/admin/devices']) {
      const next = (await call(app, 'GET', `${path}?limit=1`, { cookie: admin.cookie })).json().next
      assert.equal((await call(app, 'GET', `${path}?limit=1&before=${encodeURIComponent(next)}`, { cookie: admin.cookie })).statusCode, 200, path)
    }
  } finally { await app.close(); await pool.end() }
})
