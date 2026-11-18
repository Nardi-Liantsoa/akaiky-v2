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
const events = (device, list) => native(ctx.app, 'POST', '/api/device/events', { token: device.accessToken, body: { events: list } })
const message = (device, slot) => native(ctx.app, 'POST', '/api/device/messages', { token: device.accessToken, body: { id: randomUUID(), slot, sentAt: new Date().toISOString() } })
const journal = (u, childId, query = '') => call(ctx.app, 'GET', `/api/children/${childId}/journal${query}`, { cookie: u.cookie })
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pairedChild(owner, firstName) {
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { firstName } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}

test('journal : appels, bloqués, déverrouillages et messages, du plus récent au plus ancien, filtres et compteur', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  const maman = (await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Maman', phone: '034 12 345 67' } })).json()
  const out = { id: randomUUID(), kind: 'call_out', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt: at(50), durationS: 42 }
  const inc = { id: randomUUID(), kind: 'call_in', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt: at(40), durationS: 10 }
  const b1 = { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(30) }
  const b2 = { id: randomUUID(), kind: 'call_blocked', startedAt: at(20) }
  const unlock = { id: randomUUID(), kind: 'unlock', source: 'code', startedAt: at(10), durationS: 900 }
  assert.equal((await events(fy.device, [out, inc, b1, b2, unlock])).json().accepted.length, 5)
  assert.equal((await message(fy.device, 2)).statusCode, 200)

  const all = await journal(member, fy.kid.id, '?counts=1')
  assert.equal(all.statusCode, 200, all.body)
  assert.deepEqual(all.json().items.map((i) => i.kind), ['message', 'unlock', 'call_blocked', 'call_blocked', 'call_in', 'call_out'])
  assert.equal(all.json().counts.blocked, 2)
  const [msg, unl, hidden, blocked] = all.json().items
  assert.equal(msg.slot, 2)
  assert.deepEqual(msg.readBy, [])
  assert.equal(unl.source, 'code')
  assert.equal(hidden.phone, null)
  assert.equal(blocked.phone, '+261329876543')
  assert.equal(all.json().items[4].name, 'Maman')

  assert.deepEqual((await journal(owner, fy.kid.id, '?kind=calls')).json().items.map((i) => i.kind), ['call_in', 'call_out'])
  assert.deepEqual((await journal(owner, fy.kid.id, '?kind=blocked')).json().items.map((i) => i.id), [b2.id, b1.id])
  assert.deepEqual((await journal(owner, fy.kid.id, '?kind=messages')).json().items.map((i) => i.kind), ['message'])
  assert.equal((await journal(owner, fy.kid.id)).json().counts, undefined, 'compteur sur demande seulement')
})

test('cloisonnement : autre famille 404, sans session 401, admin sans accès', async () => {
  const a = await newUser(ctx)
  await family(a)
  const x = await pairedChild(a, 'Fy')
  await events(x.device, [{ id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(1) }])
  const b = await newUser(ctx)
  await family(b)
  assert.equal((await journal(b, x.kid.id)).statusCode, 404)
  assert.equal((await journal(b, randomUUID())).statusCode, 404)
  assert.equal((await journal(b, 'pas-un-uuid')).statusCode, 404)
  assert.equal((await journal(a, x.kid.id, '?before=abime')).statusCode, 400)
  assert.equal((await call(ctx.app, 'GET', `/api/children/${x.kid.id}/journal`)).statusCode, 401)
  const admin = await newUser(ctx, { admin: true })
  assert.ok([403, 404].includes((await journal(admin, x.kid.id)).statusCode))
})

test('pagination stable : ni doublon ni trou quand des événements arrivent entre deux pages', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const batch = Array.from({ length: 25 }, (_, i) => ({ id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(200 - i) }))
  await events(fy.device, batch)
  // Messages reçus dans la même milliseconde ou presque : départagés par l'identifiant.
  for (let i = 0; i < 6; i++) await message(fy.device, 1 + (i % 4))
  const first = (await journal(owner, fy.kid.id, '?limit=10')).json()
  assert.equal(first.items.length, 10)
  await message(fy.device, 3)
  await events(fy.device, [{ id: randomUUID(), kind: 'call_blocked', startedAt: at(0) }])
  const seen = [...first.items]
  let next = first.next
  while (next) {
    const page = (await journal(owner, fy.kid.id, `?limit=10&before=${encodeURIComponent(next)}`)).json()
    seen.push(...page.items)
    next = page.next
  }
  assert.equal(seen.length, 31)
  assert.equal(new Set(seen.map((i) => i.id)).size, 31)
})
