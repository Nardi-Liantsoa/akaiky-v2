// Sirène pendant un SOS (NAR-151) : réglée par owner/manager, lue par le téléphone de l'enfant.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { parentalConsent: true, firstName } })).json()
const siren = (u, id, body) => call(ctx.app, 'PUT', `/api/children/${id}/sos-siren`, { cookie: u.cookie, body })
const list = (u) => call(ctx.app, 'GET', '/api/children', { cookie: u.cookie })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })
const audits = async (id) => (await ctx.db.query("SELECT details FROM audit_log WHERE action = 'sos_siren_set' AND target = $1 ORDER BY id", [id])).rows.map((r) => r.details)

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}

async function pairedChild(owner) {
  const kid = await child(owner)
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}

test('sirène éteinte par défaut, allumée puis éteinte par l’owner ; la liste des enfants la montre', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner)
  assert.equal(kid.sosSiren, false)
  const on = await siren(owner, kid.id, { enabled: true })
  assert.equal(on.statusCode, 200, on.body)
  assert.deepEqual(on.json(), { sosSiren: true })
  assert.equal((await list(owner)).json()[0].sosSiren, true)
  assert.deepEqual((await siren(owner, kid.id, { enabled: false })).json(), { sosSiren: false })
  assert.equal((await list(owner)).json()[0].sosSiren, false)
})

test('un manager règle la sirène ; un member reçoit 403, même avec un corps invalide', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const member = await join(owner, 'member')
  const kid = await child(owner)
  assert.deepEqual((await siren(manager, kid.id, { enabled: true })).json(), { sosSiren: true })
  for (const body of [{ enabled: false }, { enabled: 'oui' }, { other: 1 }, []]) {
    assert.equal((await siren(member, kid.id, body)).statusCode, 403, JSON.stringify(body))
  }
  assert.equal((await list(member)).json()[0].sosSiren, true, 'le member lit le réglage, inchangé')
})

test('enfant d’une autre famille, inconnu ou identifiant invalide : 404', async () => {
  const a = await newUser(ctx)
  await family(a)
  const b = await newUser(ctx)
  await family(b)
  const kidB = await child(b)
  assert.equal((await siren(a, kidB.id, { enabled: true })).statusCode, 404)
  assert.equal((await siren(a, '00000000-0000-4000-8000-000000000000', { enabled: true })).statusCode, 404)
  assert.equal((await siren(a, 'pas-un-uuid', { enabled: true })).statusCode, 404)
  assert.equal((await list(b)).json()[0].sosSiren, false)
})

test('corps invalide : 400 invalid_sos_siren, rien n’est écrit', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const kid = await child(owner)
  for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }, { enabled: true, extra: 1 }, [true]]) {
    const res = await siren(owner, kid.id, body)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
    assert.equal(res.json().code, 'invalid_sos_siren', JSON.stringify(body))
  }
  assert.equal((await list(owner)).json()[0].sosSiren, false)
  assert.deepEqual(await audits(kid.id), [])
})

test('le téléphone reçoit sosSiren ; un changement fait avancer la version, une valeur inchangée non (ni audit)', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const { kid, device } = await pairedChild(owner)
  const first = await config(device)
  assert.equal(first.json().sosSiren, false)

  assert.equal((await siren(owner, kid.id, { enabled: true })).statusCode, 200)
  const second = await config(device, first.headers.etag)
  assert.equal(second.statusCode, 200, 'le réglage changé invalide le 304')
  assert.equal(second.json().sosSiren, true)
  assert.equal(second.json().version, first.json().version + 1)
  assert.notEqual(second.headers.etag, first.headers.etag)

  // Même valeur : ni écriture ni audit, le téléphone reste sur son 304.
  assert.deepEqual((await siren(owner, kid.id, { enabled: true })).json(), { sosSiren: true })
  assert.equal((await config(device, second.headers.etag)).statusCode, 304)
  assert.deepEqual(await audits(kid.id), [{ enabled: true }])

  assert.equal((await siren(owner, kid.id, { enabled: false })).statusCode, 200)
  const third = await config(device, second.headers.etag)
  assert.equal(third.json().sosSiren, false)
  assert.equal(third.json().version, first.json().version + 2)
  assert.deepEqual(await audits(kid.id), [{ enabled: true }, { enabled: false }])
})
