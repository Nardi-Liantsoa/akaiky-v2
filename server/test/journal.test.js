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
// Quelques secondes avant maintenant : toujours « aujourd'hui », sauf dans les 6 premières
// secondes après minuit à Antananarivo.
const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString()

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pairedChild(owner, firstName) {
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
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
  const out = { id: randomUUID(), kind: 'call_out', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt: secondsAgo(6), durationS: 42 }
  const inc = { id: randomUUID(), kind: 'call_in', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt: secondsAgo(5), durationS: 10 }
  const b1 = { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: secondsAgo(4) }
  const b2 = { id: randomUUID(), kind: 'call_blocked', startedAt: secondsAgo(3) }
  const unlock = { id: randomUUID(), kind: 'unlock', source: 'code', startedAt: secondsAgo(2), durationS: 900 }
  assert.equal((await events(fy.device, [out, inc, b1, b2, unlock])).json().accepted.length, 5)
  assert.equal((await message(fy.device, 2)).statusCode, 200)

  const all = await journal(member, fy.kid.id, '?counts=1')
  assert.equal(all.statusCode, 200, all.body)
  assert.deepEqual(all.json().items.map((i) => i.kind), ['message', 'unlock', 'call_blocked', 'call_blocked', 'call_in', 'call_out'])
  // Tuiles du jour (heure de Madagascar) : 2 appels, 2 bloqués, 1 message, 1 déverrouillage.
  assert.deepEqual(all.json().today, { calls: 2, blocked: 2, messages: 1, unlocks: 1 })
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
  assert.deepEqual((await journal(owner, fy.kid.id, '?kind=unlocks')).json().items.map((i) => i.kind), ['unlock'])
  assert.equal((await journal(owner, fy.kid.id)).json().today, undefined, 'nombres sur demande seulement')
})

test('tuiles du jour : un événement d’hier (heure de Madagascar) ne compte pas aujourd’hui', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  // Minuit à Antananarivo (UTC+3) = 21:00 UTC la veille : 22:00 UTC « hier » est déjà aujourd'hui.
  const { rows: [{ start }] } = await ctx.db.query("SELECT date_trunc('day', now() AT TIME ZONE 'Indian/Antananarivo') AT TIME ZONE 'Indian/Antananarivo' AS start")
  const before = new Date(start.getTime() - 60_000).toISOString(), after = new Date(start.getTime() + 60_000).toISOString()
  const ok = [{ id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: before }]
  if (Date.parse(after) < Date.now()) ok.push({ id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: after })
  await events(fy.device, ok)
  const res = (await journal(owner, fy.kid.id, '?counts=1')).json()
  assert.equal(res.today.blocked, ok.length - 1)
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

// NAR-233 : un seul jour (heure de Madagascar), liste et nombres ; jour mal formé refusé.
test('jour choisi : liste et nombres de ce jour seul, bornes du fuseau, jour invalide, autre famille', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const { rows: [{ start, today, yesterday }] } = await ctx.db.query(
    `SELECT date_trunc('day', now() AT TIME ZONE 'Indian/Antananarivo') AT TIME ZONE 'Indian/Antananarivo' AS start,
            to_char(now() AT TIME ZONE 'Indian/Antananarivo', 'YYYY-MM-DD') AS today,
            to_char((now() AT TIME ZONE 'Indian/Antananarivo') - interval '1 day', 'YYYY-MM-DD') AS yesterday`)
  // Une minute avant minuit à Antananarivo (hier) et une minute après (aujourd'hui, si déjà passé).
  const late = { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: new Date(start.getTime() - 60_000).toISOString() }
  const early = { id: randomUUID(), kind: 'call_in', name: 'Maman', phone: '+261341234567', startedAt: new Date(start.getTime() + 60_000).toISOString(), durationS: 5 }
  const list = [late]
  if (Date.parse(early.startedAt) < Date.now()) list.push(early)
  await events(fy.device, list)

  const y = (await journal(owner, fy.kid.id, `?day=${yesterday}&counts=1`)).json()
  assert.deepEqual(y.items.map((i) => i.id), [late.id])
  assert.deepEqual(y.today, { calls: 0, blocked: 1, messages: 0, unlocks: 0 })
  const d = (await journal(owner, fy.kid.id, `?day=${today}&counts=1`)).json()
  assert.ok(!d.items.some((i) => i.id === late.id), 'hier n’apparaît jamais aujourd’hui')
  assert.equal(d.today.blocked, 0)
  assert.equal(d.today.calls, list.length - 1)
  // Filtre et jour ensemble.
  assert.deepEqual((await journal(owner, fy.kid.id, `?day=${yesterday}&kind=calls`)).json().items, [])
  // Sans jour : tous les jours, comme avant.
  assert.ok((await journal(owner, fy.kid.id)).json().items.some((i) => i.id === late.id))

  for (const bad of ['2026-02-30', '2026-1-05', 'hier', '2026-11-25T00:00', '']) {
    const r = await journal(owner, fy.kid.id, `?day=${encodeURIComponent(bad)}`)
    assert.equal(r.statusCode, 400, bad)
    assert.equal(r.json().code, 'invalid_day')
  }
  const other = await newUser(ctx)
  await family(other)
  assert.equal((await journal(other, fy.kid.id, `?day=${yesterday}`)).statusCode, 404)
})
