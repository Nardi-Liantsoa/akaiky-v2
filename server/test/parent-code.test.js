import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'
import { parentCodeProblem, reserveHashSlot } from '../src/parent-code.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { firstName } })).json()
const setCode = (u, id, code) => call(ctx.app, 'PUT', `/api/children/${id}/parent-code`, { cookie: u.cookie, body: { code } })
const list = (u) => call(ctx.app, 'GET', '/api/children', { cookie: u.cookie })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}

async function pairedChild(owner, firstName) {
  const kid = await child(owner, firstName)
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}

// Vérification telle que la fera le téléphone (NAR-167), avec les seules données reçues.
function verifies(hash, code) {
  const [alg, iterations, salt, key] = hash.split('$')
  assert.equal(alg, 'pbkdf2-sha256')
  return pbkdf2Sync(code, Buffer.from(salt, 'base64'), Number(iterations), 32, 'sha256').equals(Buffer.from(key, 'base64'))
}

test('règle des codes : 6 chiffres, ni identiques ni en suite', () => {
  for (const ok of ['482915', '120934', '135790', '000001']) assert.equal(parentCodeProblem(ok), null, ok)
  for (const bad of ['', '12345', '1234567', '12 345', 'abcdef', '١٢٣٤٥٦', 123456]) assert.equal(parentCodeProblem(bad), 'invalid_parent_code', String(bad))
  for (const weak of ['000000', '777777', '123456', '456789', '654321', '987654', '012345', '901234', '890123', '121212', '123123', '112233', '998877', '111222', '123321', '482284']) assert.equal(parentCodeProblem(weak), 'weak_parent_code', weak)
})

test('un seul calcul de hachage à la fois : le suivant reçoit 503 (Retry-After) sans attendre', async () => {
  const release = reserveHashSlot()
  assert.throws(() => reserveHashSlot(), (e) => e.status === 503 && e.retryAfter === 5)
  release()
  release()
  const again = reserveHashSlot()
  assert.throws(() => reserveHashSlot(), (e) => e.status === 503, 'libérer deux fois ne crée pas de seconde place')
  again()
})

test('le gestionnaire définit puis change le code ; le téléphone de l’enfant reçoit un hachage vérifiable, sans 304 périmé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const { kid, device } = await pairedChild(owner, 'Fy')

  // Pas encore de code : null pour le téléphone, null pour les parents.
  const before = await config(device)
  assert.equal(before.json().parentCode, null)
  assert.equal((await list(owner)).json()[0].parentCodeSetAt, null)

  const set = await setCode(manager, kid.id, '482915')
  assert.equal(set.statusCode, 200, set.body)
  assert.deepEqual(Object.keys(set.json()), ['parentCodeSetAt'])
  const first = await config(device, before.headers.etag)
  assert.equal(first.statusCode, 200, 'un nouveau code invalide le 304')
  assert.ok(verifies(first.json().parentCode, '482915'))
  assert.ok(!verifies(first.json().parentCode, '482916'))
  assert.equal(first.json().parentCode.split('$')[1], '600000')
  assert.ok((await list(owner)).json()[0].parentCodeSetAt)

  // Même code redéfini : nouveau sel, nouveau hachage.
  assert.equal((await setCode(owner, kid.id, '482915')).statusCode, 200)
  const again = await config(device, first.headers.etag)
  assert.equal(again.statusCode, 200)
  assert.notEqual(again.json().parentCode, first.json().parentCode)

  assert.equal((await setCode(owner, kid.id, '305718')).statusCode, 200)
  const changed = (await config(device, again.headers.etag)).json().parentCode
  assert.ok(verifies(changed, '305718'))
  assert.ok(!verifies(changed, '482915'), 'l’ancien code ne vaut plus')

  const { rows } = await ctx.db.query("SELECT actor_id, details FROM audit_log WHERE action = 'parent_code_set' AND target = $1", [kid.id])
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.details === null), 'aucun code ni hachage dans le journal')
})

test('un contact ne change pas le code (403) ; une autre famille ou un enfant inconnu : 404', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const kid = await child(owner)
  assert.equal((await setCode(member, kid.id, '482915')).statusCode, 403)
  // Le refus a lieu avant tout calcul, même avec un code invalide.
  assert.equal((await setCode(member, kid.id, '1')).statusCode, 403)

  const stranger = await newUser(ctx)
  await family(stranger)
  assert.equal((await setCode(stranger, kid.id, '482915')).statusCode, 404)
  assert.equal((await setCode(stranger, crypto.randomUUID(), '482915')).statusCode, 404)
  assert.equal((await setCode(stranger, 'pas-un-uuid', '482915')).statusCode, 404)
  const noFamily = await newUser(ctx)
  assert.equal((await setCode(noFamily, kid.id, '482915')).statusCode, 404)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/parent-code`, { body: { code: '482915' } })).statusCode, 401)

  const { rows: [row] } = await ctx.db.query('SELECT parent_code_hash FROM children WHERE id = $1', [kid.id])
  assert.equal(row.parent_code_hash, null, 'aucun refus n’a écrit de code')
})

test('codes invalides ou triviaux : 400 avec un code stable ; champ inconnu refusé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner)
  for (const [code, expected] of [['12345', 'invalid_parent_code'], ['12a456', 'invalid_parent_code'], ['111111', 'weak_parent_code'], ['123456', 'weak_parent_code']]) {
    const res = await setCode(owner, kid.id, code)
    assert.equal(res.statusCode, 400, code)
    assert.equal(res.json().code, expected, code)
  }
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/parent-code`, { cookie: owner.cookie, body: { code: 123456 } })).statusCode, 400)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/parent-code`, { cookie: owner.cookie, body: { code: '482915', parentCodeHash: 'x' } })).statusCode, 400)
  assert.equal((await call(ctx.app, 'PATCH', `/api/children/${kid.id}`, { cookie: owner.cookie, body: { parentCodeSetAt: null } })).statusCode, 400)
})

test('le hachage n’atteint aucun compte ; seul le téléphone de CET enfant le reçoit', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const tiana = await pairedChild(owner, 'Tiana')
  assert.equal((await setCode(owner, fy.kid.id, '482915')).statusCode, 200)
  const hash = (await config(fy.device)).json().parentCode
  const [, , salt, key] = hash.split('$')

  // Réponses destinées aux parents : liste, création, modification, définition du code.
  const responses = [
    await list(owner),
    await call(ctx.app, 'PATCH', `/api/children/${fy.kid.id}`, { cookie: owner.cookie, body: { firstName: 'Fyfy' } }),
    await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { firstName: 'Hery' } }),
    await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/devices`, { cookie: owner.cookie }),
    await call(ctx.app, 'GET', '/api/families/me', { cookie: owner.cookie })
  ]
  for (const res of responses) {
    assert.ok(res.statusCode < 300, res.body)
    assert.ok(!res.body.includes(key) && !res.body.includes(salt) && !res.body.includes('pbkdf2'), res.body)
  }
  // Le téléphone d'un autre enfant de la même famille ne le reçoit pas.
  assert.equal((await config(tiana.device)).json().parentCode, null)
})

test('changements trop nombreux : 429 par compte', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner)
  for (let i = 0; i < 10; i++) assert.equal((await setCode(owner, kid.id, '482915')).statusCode, 200)
  assert.equal((await setCode(owner, kid.id, '482915')).statusCode, 429)
})
