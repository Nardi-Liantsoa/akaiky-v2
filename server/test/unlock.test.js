import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { firstName } })).json()
const setCode = (u, id) => call(ctx.app, 'PUT', `/api/children/${id}/parent-code`, { cookie: u.cookie, body: { code: '482915' } })
const unlock = (u, id) => call(ctx.app, 'POST', `/api/children/${id}/unlock`, { cookie: u.cookie })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })
const events = (device, list) => native(ctx.app, 'POST', '/api/device/events', { token: device.accessToken, body: { events: list } })

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

test('déverrouillage à distance : 15 minutes, lu par le seul téléphone de l’enfant, sans 304 périmé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const fy = await pairedChild(owner, 'Fy')
  const tiana = await pairedChild(owner, 'Tiana')
  assert.equal((await setCode(owner, fy.kid.id)).statusCode, 200)
  const before = await config(fy.device)
  assert.equal(before.json().remoteUnlockUntil, null)

  const t0 = Date.now()
  const res = await unlock(manager, fy.kid.id)
  assert.equal(res.statusCode, 200, res.body)
  const until = Date.parse(res.json().remoteUnlockUntil)
  assert.ok(Math.abs(until - (t0 + 15 * 60_000)) < 10_000, 'échéance à 15 minutes')

  const after = await config(fy.device, before.headers.etag)
  assert.equal(after.statusCode, 200, 'la demande invalide le 304')
  assert.equal(Date.parse(after.json().remoteUnlockUntil), until)
  assert.equal((await config(tiana.device)).json().remoteUnlockUntil, null, 'pas pour un autre enfant')
  const kids = (await call(ctx.app, 'GET', '/api/children', { cookie: owner.cookie })).json()
  assert.equal(Date.parse(kids.find((k) => k.id === fy.kid.id).remoteUnlockUntil), until)

  // Échéance passée : jamais renvoyée (ni au téléphone, ni aux parents).
  await ctx.db.query("UPDATE children SET remote_unlock_until = now() - interval '1 second' WHERE id = $1", [fy.kid.id])
  assert.equal((await config(fy.device)).json().remoteUnlockUntil, null)
  assert.equal((await call(ctx.app, 'GET', '/api/children', { cookie: owner.cookie })).json().find((k) => k.id === fy.kid.id).remoteUnlockUntil, null)

  const { rows } = await ctx.db.query("SELECT actor_id FROM audit_log WHERE action = 'remote_unlock' AND target = $1", [fy.kid.id])
  assert.equal(rows.length, 1)

  // Nouveau code parent : une demande en attente est annulée (ancien code, mauvais clic).
  assert.equal((await unlock(owner, fy.kid.id)).statusCode, 200)
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${fy.kid.id}/parent-code`, { cookie: owner.cookie, body: { code: '305718' } })).statusCode, 200)
  assert.equal((await config(fy.device)).json().remoteUnlockUntil, null)
})

test('déverrouillage à distance : contact 403, autre famille 404, sans code parent 409', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const kid = await child(owner)
  const refused = await unlock(owner, kid.id)
  assert.equal(refused.statusCode, 409)
  assert.equal(refused.json().code, 'no_parent_code')
  // Les refus (409, 404) n'entament pas le quota de 20 demandes par heure.
  for (let i = 0; i < 21; i++) assert.equal((await unlock(owner, kid.id)).statusCode, 409)
  await setCode(owner, kid.id)
  assert.equal((await unlock(member, kid.id)).statusCode, 403)
  const stranger = await newUser(ctx)
  await family(stranger)
  assert.equal((await unlock(stranger, kid.id)).statusCode, 404)
  assert.equal((await unlock(stranger, randomUUID())).statusCode, 404)
  assert.equal((await call(ctx.app, 'POST', `/api/children/${kid.id}/unlock`)).statusCode, 401)
  const { rows: [row] } = await ctx.db.query('SELECT remote_unlock_until FROM children WHERE id = $1', [kid.id])
  assert.equal(row.remote_unlock_until, null, 'aucun refus n’a posé d’échéance')
})

test('journal : un déverrouillage (code ou distance) est enregistré pour l’enfant du téléphone seulement', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const other = await newUser(ctx)
  await family(other)
  const stranger = await pairedChild(other, 'Hery')

  const byCode = { id: randomUUID(), kind: 'unlock', source: 'code', startedAt: new Date().toISOString(), durationS: 900 }
  const byRemote = { id: randomUUID(), kind: 'unlock', source: 'remote', startedAt: new Date().toISOString(), durationS: 600 }
  const res = await events(fy.device, [byCode, byRemote])
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().accepted.sort(), [byCode.id, byRemote.id].sort())
  const { rows } = await ctx.db.query('SELECT id, child_id, kind, unlock_source, duration_s, contact_id FROM device_events WHERE id = ANY($1) ORDER BY duration_s DESC', [[byCode.id, byRemote.id]])
  assert.deepEqual(rows.map((r) => [r.child_id, r.kind, r.unlock_source, r.duration_s, r.contact_id]),
    [[fy.kid.id, 'unlock', 'code', 900, null], [fy.kid.id, 'unlock', 'remote', 600, null]])

  // Même identifiant envoyé par le téléphone d'une autre famille : refusé, rien d'écrit chez elle.
  assert.deepEqual((await events(stranger.device, [byCode])).json().rejected, [byCode.id])
  const { rowCount } = await ctx.db.query('SELECT 1 FROM device_events WHERE child_id = $1', [stranger.kid.id])
  assert.equal(rowCount, 0)
})

test('journal : un déverrouillage mal formé est refusé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const base = { kind: 'unlock', source: 'code', startedAt: new Date().toISOString(), durationS: 900 }
  const bad = [
    { ...base, id: randomUUID(), source: undefined },
    { ...base, id: randomUUID(), contactId: randomUUID() },
    { ...base, id: randomUUID(), phone: '+261341234567' },
    { ...base, id: randomUUID(), durationS: 901 },
    { ...base, id: randomUUID(), durationS: 0 },
    { ...base, id: randomUUID(), durationS: null },
    { id: randomUUID(), kind: 'call_out', source: 'code', contactId: randomUUID(), startedAt: base.startedAt }
  ].map((e) => JSON.parse(JSON.stringify(e)))
  const res = await events(fy.device, bad)
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().rejected.sort(), bad.map((e) => e.id).sort())
  assert.equal((await events(fy.device, [{ ...base, id: randomUUID(), source: 'admin' }])).statusCode, 400)
})
