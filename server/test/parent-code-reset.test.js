// Demande d'un nouveau code parent par l'équipe (NAR-200, back-office tranche 3) : droits
// (admin MFA seulement), audit, ancien code toujours valable (même hachage, configuration du
// téléphone inchangée, 304 gardé), déverrouillage à distance intact, demande vue par les
// gestionnaires puis effacée par leur nouveau code, enfants d'une famille vus par l'équipe,
// champs inconnus, rôle SQL restreint.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { pbkdf2Sync, randomUUID } from 'node:crypto'
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
const resetUrl = (id) => `/api/admin/children/${id}/parent-code/reset`
const reset = (app, u, id, body) => call(app, 'POST', resetUrl(id), { cookie: u?.cookie, ...(body !== undefined ? { body } : {}) })
const setCode = (app, u, id, code) => call(app, 'PUT', `/api/children/${id}/parent-code`, { cookie: u.cookie, body: { code } })
const childOf = async (u, id) => (await call(ctx.app, 'GET', '/api/children', { cookie: u.cookie })).json().find((c) => c.id === id)
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })
const auditOf = async (action, target) => (await ctx.db.query(
  'SELECT actor_id, details FROM audit_log WHERE action = $1 AND target = $2 ORDER BY id', [action, target])).rows
const state = async (id) => (await ctx.db.query(
  'SELECT parent_code_hash, config_version, parent_code_reset_requested_at FROM children WHERE id = $1', [id])).rows[0]

function verifies(hash, code) {
  const [, iterations, salt, key] = hash.split('$')
  return pbkdf2Sync(code, Buffer.from(salt, 'base64'), Number(iterations), 32, 'sha256').equals(Buffer.from(key, 'base64'))
}

// Famille avec un enfant, son code parent et son téléphone appairé.
async function familyWithCode(code = '482915') {
  const owner = await newUser(ctx)
  assert.equal((await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })).statusCode, 201)
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
  assert.equal((await setCode(ctx.app, owner, kid.id, code)).statusCode, 200)
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel' } })
  assert.equal(res.statusCode, 201, res.body)
  const { rows: [{ family_id: familyId }] } = await ctx.db.query('SELECT family_id FROM children WHERE id = $1', [kid.id])
  return { owner, kid, familyId, device: res.json() }
}

test('droits : 401 sans session, 403 pour un parent (cookie et Bearer), 401 admin sans MFA vérifiée ; rien d’écrit', async () => {
  const { owner, kid } = await familyWithCode()
  const bearer = (await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: owner.email, password: owner.password } })).json().accessToken
  const unverified = await newUser(ctx, { admin: true })
  await ctx.db.query('UPDATE sessions SET mfa_verified_at = NULL WHERE user_id = $1', [unverified.id])
  const urls = [resetUrl(kid.id), '/api/admin/families/' + randomUUID() + '/children']
  for (const url of urls) {
    const method = url.endsWith('/reset') ? 'POST' : 'GET'
    assert.equal((await call(ctx.app, method, url, {})).statusCode, 401, url)
    // Le gestionnaire de la famille elle-même n'est pas l'équipe.
    assert.equal((await call(ctx.app, method, url, { cookie: owner.cookie })).statusCode, 403, url)
    assert.equal((await native(ctx.app, method, url, { token: bearer })).statusCode, 403, url)
    assert.equal((await call(ctx.app, method, url, { cookie: unverified.cookie })).statusCode, 401, url)
  }
  assert.equal((await state(kid.id)).parent_code_reset_requested_at, null)
  assert.equal((await auditOf('parent_code_reset_requested', kid.id)).length, 0)
})

test('demande : auditée, ancien code toujours valable, configuration du téléphone inchangée, déverrouillage à distance intact', async () => {
  const admin = await newUser(ctx, { admin: true })
  const { owner, kid, device } = await familyWithCode('482915')
  const before = await state(kid.id)
  const cfg = await config(device)
  assert.equal(cfg.statusCode, 200)

  const r = await reset(ctx.app, admin, kid.id)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json(), { ok: true })
  const after = await state(kid.id)
  assert.ok(after.parent_code_reset_requested_at, 'demande posée')
  assert.equal(after.parent_code_hash, before.parent_code_hash, 'hachage inchangé')
  assert.equal(after.config_version, before.config_version, 'config_version inchangée')
  // Le téléphone garde sa configuration (304) et l'ancien code s'y vérifie toujours.
  assert.equal((await config(device, cfg.headers.etag)).statusCode, 304)
  assert.ok(verifies(cfg.json().parentCode, '482915'))
  const lines = await auditOf('parent_code_reset_requested', kid.id)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].actor_id, admin.id)
  assert.equal(lines[0].details, null)

  // Déverrouillage à distance : toujours possible, et reçu par le téléphone.
  const unlock = await call(ctx.app, 'POST', `/api/children/${kid.id}/unlock`, { cookie: owner.cookie })
  assert.equal(unlock.statusCode, 200, unlock.body)
  assert.ok((await config(device)).json().remoteUnlockUntil)

  // Déjà demandée : 200, rien d'écrit, aucune seconde ligne d'audit.
  assert.equal((await reset(ctx.app, admin, kid.id)).statusCode, 200)
  assert.equal((await auditOf('parent_code_reset_requested', kid.id)).length, 1)
  assert.equal((await state(kid.id)).parent_code_reset_requested_at.getTime(), after.parent_code_reset_requested_at.getTime())
  // Même si la famille a perdu depuis son canal écrit, une demande déjà posée reste un 200 sans écriture.
  await ctx.db.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [owner.id])
  assert.equal((await reset(ctx.app, admin, kid.id)).statusCode, 200)
  assert.equal((await auditOf('parent_code_reset_requested', kid.id)).length, 1)
})

test('le gestionnaire voit la demande ; son nouveau code l’efface et seul le nouveau code vaut', async () => {
  const admin = await newUser(ctx, { admin: true })
  const { owner, kid, device } = await familyWithCode('482915')
  assert.equal((await childOf(owner, kid.id)).parentCodeResetRequestedAt, null)
  assert.equal((await reset(ctx.app, admin, kid.id)).statusCode, 200)
  assert.ok((await childOf(owner, kid.id)).parentCodeResetRequestedAt, 'visible des parents')

  assert.equal((await setCode(ctx.app, owner, kid.id, '305718')).statusCode, 200)
  assert.equal((await childOf(owner, kid.id)).parentCodeResetRequestedAt, null, 'effacée par le nouveau code')
  assert.equal((await state(kid.id)).parent_code_reset_requested_at, null)
  const code = (await config(device)).json().parentCode
  assert.ok(verifies(code, '305718'))
  assert.ok(!verifies(code, '482915'))
  // Une nouvelle demande reste possible ensuite (nouvelle ligne d'audit).
  assert.equal((await reset(ctx.app, admin, kid.id)).statusCode, 200)
  assert.equal((await auditOf('parent_code_reset_requested', kid.id)).length, 2)
})

test('refus : enfant inconnu ou id mal formé 404, sans code parent ou sans gestionnaire à adresse 409, paramètre ou champ inconnu 400', async () => {
  const admin = await newUser(ctx, { admin: true })
  const { kid } = await familyWithCode()
  for (const id of [randomUUID(), 'pas-un-uuid']) {
    const r = await reset(ctx.app, admin, id)
    assert.equal(r.statusCode, 404, id)
    assert.equal(r.json().code, 'child_not_found')
  }
  // Enfant sans code : rien à remplacer.
  const owner = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })
  const bare = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Mi' } })).json()
  const none = await reset(ctx.app, admin, bare.id)
  assert.equal(none.statusCode, 409)
  assert.equal(none.json().code, 'no_parent_code')
  assert.equal((await state(bare.id)).parent_code_reset_requested_at, null)

  // Famille dont le seul gestionnaire a un compte par numéro : pas de demande écrite vérifiable.
  const sms = await familyWithCode()
  await ctx.db.query("UPDATE users SET email = NULL, phone = $2, phone_verified_at = now() WHERE id = $1",
    [sms.owner.id, `+26134${String(process.pid % 1000).padStart(3, '0')}0001`])
  const noMail = await reset(ctx.app, admin, sms.kid.id)
  assert.equal(noMail.statusCode, 409)
  assert.equal(noMail.json().code, 'no_written_channel')
  assert.equal((await state(sms.kid.id)).parent_code_reset_requested_at, null)
  assert.equal((await auditOf('parent_code_reset_requested', sms.kid.id)).length, 0)
  // Adresse jamais confirmée : pas un canal écrit prouvé.
  const unconfirmed = await familyWithCode()
  await ctx.db.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [unconfirmed.owner.id])
  assert.equal((await reset(ctx.app, admin, unconfirmed.kid.id)).json().code, 'no_written_channel')

  assert.equal((await reset(ctx.app, admin, kid.id, { code: '000000' })).statusCode, 400)
  assert.equal((await call(ctx.app, 'POST', `${resetUrl(kid.id)}?force=1`, { cookie: admin.cookie })).statusCode, 400)
  assert.equal((await reset(ctx.app, admin, kid.id, {})).statusCode, 200, 'corps vide accepté')

  const famUnknown = await call(ctx.app, 'GET', `/api/admin/families/${randomUUID()}/children`, { cookie: admin.cookie })
  assert.equal(famUnknown.statusCode, 404)
  assert.equal(famUnknown.json().code, 'family_not_found')
  assert.equal((await call(ctx.app, 'GET', '/api/admin/families/x/children', { cookie: admin.cookie })).statusCode, 404)
})

test('enfants d’une famille vus par l’équipe : identifiant, date, code défini, demande ; seulement cette famille', async () => {
  const admin = await newUser(ctx, { admin: true })
  const a = await familyWithCode()
  const b = await familyWithCode()
  const second = (await call(ctx.app, 'POST', '/api/children', { cookie: a.owner.cookie, body: { parentalConsent: true, firstName: 'Mi' } })).json()
  assert.equal((await reset(ctx.app, admin, a.kid.id)).statusCode, 200)
  const r = await call(ctx.app, 'GET', `/api/admin/families/${a.familyId}/children`, { cookie: admin.cookie })
  assert.equal(r.statusCode, 200, r.body)
  const kids = r.json()
  assert.deepEqual(kids.map((k) => k.id), [a.kid.id, second.id], 'ordre de création, pas l’enfant de B')
  assert.deepEqual(kids.map((k) => k.codeSet), [true, false])
  assert.ok(kids[0].newCodeRequestedAt)
  assert.equal(kids[1].newCodeRequestedAt, null)
  assert.ok(!r.body.includes('Fy') && !r.body.includes('Mi'), 'aucun prénom')
  assert.ok(!kids.some((k) => k.id === b.kid.id))
  assert.equal((await call(ctx.app, 'GET', `/api/admin/families/${a.familyId}/children?limit=1`, { cookie: admin.cookie })).statusCode, 400)
})

test('rôle SQL restreint app_runtime : la demande et son effacement passent ; la migration accorde le droit', async () => {
  const sql = (await readFile(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8')).replace(":'runtime_password'", "'runtime-test-only'")
  await ctx.db.query(sql)
  await ctx.db.query('REVOKE UPDATE (parent_code_reset_requested_at) ON children FROM app_runtime')
  await ctx.db.query((await readFile(new URL('../src/migrations/029_parent_code_reset.sql', import.meta.url), 'utf8'))
    .replace('ALTER TABLE children ADD COLUMN parent_code_reset_requested_at timestamptz;', ''))
  const { rows } = await ctx.db.query(
    `SELECT column_name FROM information_schema.column_privileges
      WHERE grantee = 'app_runtime' AND table_name = 'children' AND privilege_type = 'UPDATE'`)
  assert.ok(rows.some((r) => r.column_name === 'parent_code_reset_requested_at'))

  const admin = await newUser(ctx, { admin: true })
  const { owner, kid, familyId } = await familyWithCode()
  const url = new URL(dbh.url); url.username = 'app_runtime'; url.password = 'runtime-test-only'
  const pool = createPool(url.toString())
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), APP_ORIGIN: ORIGIN, NATIVE_ORIGINS: `${NATIVE},https://localhost`, RATE_LIMIT_IP: '10000', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), ...APK })
  const app = await buildApp({ config, db: pool, mailer: { async send() {} }, logger: false })
  try {
    assert.equal((await pool.query('SELECT current_user AS u')).rows[0].u, 'app_runtime')
    assert.equal((await reset(app, admin, kid.id)).statusCode, 200)
    assert.equal((await call(app, 'GET', `/api/admin/families/${familyId}/children`, { cookie: admin.cookie })).statusCode, 200)
    assert.equal((await setCode(app, owner, kid.id, '305718')).statusCode, 200)
    assert.equal((await state(kid.id)).parent_code_reset_requested_at, null)
  } finally { await app.close(); await pool.end() }
})
