// SOS en ligne (NAR-248) : alerte, annulation, positions, prise en charge, isolation, push.
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
const open = (device, clientId = randomUUID()) => native(ctx.app, 'POST', '/api/device/sos', { token: device.accessToken, body: { clientId } })
const cancel = (device, id) => native(ctx.app, 'POST', `/api/device/sos/${id}/cancel`, { token: device.accessToken })
const position = (device, id, body = { lat: -18.914561, lng: 47.531234, accuracyM: 12, ageS: 3 }) =>
  native(ctx.app, 'POST', `/api/device/sos/${id}/positions`, { token: device.accessToken, body })
const read = (u, id) => call(ctx.app, 'GET', `/api/sos/${id}`, { cookie: u.cookie })
const act = (u, id, kind) => call(ctx.app, 'POST', `/api/sos/${id}/${kind}`, { cookie: u.cookie })
const pushToken = (u) => call(ctx.app, 'PUT', '/api/push/token', { cookie: u.cookie, body: { token: `fcm-${randomUUID()}`, platform: 'android', lang: 'fr' } })
const outbox = async (ref, event = 'sos') => (await ctx.db.query('SELECT owner_key, kind FROM push_outbox WHERE ref = $1 AND event = $2 ORDER BY owner_key', [ref, event])).rows

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pairedChild(owner, firstName = 'Fy') {
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}
async function famille() {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner)
  return { owner, manager, member, fy }
}

test('SOS ouvert : une alerte de 15 min, notification `sos` à chaque membre (member compris), renvoi idempotent', async () => {
  const { owner, manager, member, fy } = await famille()
  for (const u of [owner, manager, member]) assert.equal((await pushToken(u)).statusCode, 200)
  const clientId = randomUUID()
  const t0 = Date.now()
  const res = await open(fy.device, clientId)
  assert.equal(res.statusCode, 201, res.body)
  const a = res.json()
  assert.equal(a.status, 'active')
  assert.equal(a.childId, fy.kid.id)
  assert.ok(Math.abs(Date.parse(a.endsAt) - (t0 + 15 * 60_000)) < 10_000)
  const queued = await outbox(a.id)
  assert.equal(queued.length, 3)
  assert.ok(queued.every((q) => q.owner_key.endsWith(':sos') && q.kind === 'notification'), 'plafond horaire à part')

  // Renvoi (réponse perdue) : même alerte, aucune notification de plus.
  const again = await open(fy.device, clientId.toUpperCase())
  assert.equal(again.statusCode, 200)
  assert.equal(again.json().id, a.id)
  assert.equal((await outbox(a.id)).length, 3)
  assert.equal((await ctx.db.query('SELECT 1 FROM sos_alerts WHERE child_id = $1', [fy.kid.id])).rows.length, 1)
})

test('SOS : champs inconnus ou mal formés refusés ; session de compte refusée', async () => {
  const { owner, fy } = await famille()
  for (const body of [{}, { clientId: 'x' }, { clientId: randomUUID(), childId: randomUUID() }, { clientId: randomUUID(), familyId: randomUUID() }]) {
    assert.equal((await native(ctx.app, 'POST', '/api/device/sos', { token: fy.device.accessToken, body })).statusCode, 400, JSON.stringify(body))
  }
  assert.ok([401, 403].includes((await call(ctx.app, 'POST', '/api/device/sos', { cookie: owner.cookie, body: { clientId: randomUUID() } })).statusCode))
})

test('annulation : dans les 5 s, notifiée ; après 5 s, refusée et l’alerte reste ouverte', async () => {
  const { owner, fy } = await famille()
  assert.equal((await pushToken(owner)).statusCode, 200)
  const a = (await open(fy.device)).json()
  const res = await cancel(fy.device, a.id)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().status, 'cancelled')
  assert.equal((await outbox(a.id, 'sos_cancelled')).length, 1)
  assert.equal((await cancel(fy.device, a.id)).statusCode, 200, 'idempotente')
  assert.equal((await position(fy.device, a.id)).statusCode, 409, 'plus de position après annulation')

  const b = (await open(fy.device)).json()
  await ctx.db.query("UPDATE sos_alerts SET started_at = now() - interval '6 seconds' WHERE id = $1", [b.id])
  const late = await cancel(fy.device, b.id)
  assert.equal(late.statusCode, 409)
  assert.equal(late.json().code, 'sos_too_late')
  assert.equal((await read(owner, b.id)).json().status, 'active')
})

test('positions : pendant l’alerte ouverte seulement, chiffrées, montrées aux membres ; jamais l’alerte d’un autre téléphone', async () => {
  const { owner, member, fy } = await famille()
  const a = (await open(fy.device)).json()
  assert.equal((await read(member, a.id)).json().position, null)
  assert.equal((await position(fy.device, a.id)).statusCode, 200)
  const seen = (await read(member, a.id)).json()
  assert.equal(seen.position.lat, -18.914561)
  assert.equal(seen.position.accuracyM, 12)
  const { rows: [stored] } = await ctx.db.query('SELECT source, sos_id, lat_enc FROM positions WHERE sos_id = $1', [a.id])
  assert.equal(stored.source, 'sos')
  assert.ok(!stored.lat_enc.toString('latin1').includes('18.914'), 'chiffrée')
  for (const body of [{ lat: 1, lng: 1, accuracyM: 1 }, { lat: 91, lng: 1, accuracyM: 1, ageS: 0 }, { lat: 1, lng: 1, accuracyM: 1, ageS: 0, sosId: a.id }]) {
    assert.equal((await position(fy.device, a.id, body)).statusCode, 400)
  }
  // Un autre téléphone (autre famille) ne peut pas écrire dans cette alerte.
  const other = await newUser(ctx)
  await family(other)
  const koto = await pairedChild(other, 'Koto')
  assert.equal((await position(koto.device, a.id)).statusCode, 404)
  assert.equal((await cancel(koto.device, a.id)).statusCode, 404)
  // 15 minutes passées : plus de position.
  await ctx.db.query("UPDATE sos_alerts SET started_at = now() - interval '16 minutes', ends_at = now() - interval '1 minute' WHERE id = $1", [a.id])
  const closed = await position(fy.device, a.id)
  assert.equal(closed.statusCode, 409)
  assert.equal(closed.json().code, 'sos_closed')
  assert.equal((await read(owner, a.id)).json().status, 'ended')
})

test('prise en charge : la première gagne, un member la prend, les autres la voient ; vu et « j’arrive » une fois', async () => {
  const { owner, manager, member, fy } = await famille()
  const a = (await open(fy.device)).json()
  assert.equal((await act(owner, a.id, 'seen')).statusCode, 200)
  assert.equal((await act(owner, a.id, 'seen')).statusCode, 200)
  assert.equal((await act(manager, a.id, 'coming')).statusCode, 200)
  const taken = await act(member, a.id, 'handle')
  assert.equal(taken.statusCode, 200, taken.body)
  assert.equal(taken.json().status, 'handled')
  assert.equal(taken.json().handledBy.isMe, true)
  const refused = await act(owner, a.id, 'handle')
  assert.equal(refused.statusCode, 409)
  assert.equal(refused.json().code, 'sos_already_handled')
  const view = (await read(owner, a.id)).json()
  assert.equal(view.handledBy.name, (await ctx.db.query('SELECT name FROM users WHERE email = $1', [member.email])).rows[0].name)
  assert.equal(view.handledBy.isMe, false)
  assert.deepEqual(view.events.map((e) => e.kind), ['seen', 'coming', 'handled'])
  assert.equal(view.events.filter((e) => e.isMe).length, 1)
  // Prise en charge : la position n'est plus envoyée.
  assert.equal((await position(fy.device, a.id)).statusCode, 409)
  // Simultanées : une seule gagne.
  const b = (await open(fy.device)).json()
  const results = await Promise.all([act(owner, b.id, 'handle'), act(manager, b.id, 'handle')])
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409])
  // Annulée : pas de prise en charge.
  const c = (await open(fy.device)).json()
  await cancel(fy.device, c.id)
  assert.equal((await act(owner, c.id, 'handle')).json().code, 'sos_cancelled')
})

test('isolation : une autre famille ne voit ni ne touche l’alerte (404) ; dernière alerte de l’enfant pour ses membres', async () => {
  const { owner, member, fy } = await famille()
  const a = (await open(fy.device)).json()
  const stranger = await newUser(ctx)
  await family(stranger)
  for (const kind of ['seen', 'coming', 'handle']) assert.equal((await act(stranger, a.id, kind)).statusCode, 404)
  assert.equal((await read(stranger, a.id)).statusCode, 404)
  assert.equal((await read(owner, randomUUID())).statusCode, 404)
  assert.equal((await read(owner, 'pas-un-uuid')).statusCode, 404)
  assert.equal((await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/sos`, { cookie: stranger.cookie })).statusCode, 404)
  const latest = (await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/sos`, { cookie: member.cookie })).json()
  assert.equal(latest.sos.id, a.id)
  // Sans session : 401. Corps envoyé sur une action : 400.
  assert.equal((await call(ctx.app, 'GET', `/api/sos/${a.id}`)).statusCode, 401)
  assert.equal((await call(ctx.app, 'POST', `/api/sos/${a.id}/seen`, { cookie: owner.cookie, body: { userId: randomUUID() } })).statusCode, 400)
  // Ni position ni prénom dans l'audit.
  const audits = JSON.stringify((await ctx.db.query("SELECT action, details FROM audit_log WHERE action LIKE 'sos_%'")).rows)
  assert.ok(!audits.includes('18.9') && !audits.includes('Fy'))
})
