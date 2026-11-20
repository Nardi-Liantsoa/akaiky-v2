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
const calls = (u, childId, query = '') => call(ctx.app, 'GET', `/api/children/${childId}/calls${query}`, { cookie: u.cookie })

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
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString()

test('appels reçus et bloqués : enregistrés, numéro inconnu chiffré au repos, lus par tous les membres', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  const maman = (await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Maman', phone: '034 12 345 67' } })).json()

  const incoming = { id: randomUUID(), kind: 'call_in', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt: at(3), durationS: 75 }
  const blocked = { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(2) }
  const hidden = { id: randomUUID(), kind: 'call_blocked', startedAt: at(1) }
  const res = await events(fy.device, [incoming, blocked, hidden])
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().accepted.length, 3)
  // Rejoué (file hors ligne renvoyée) : aucun doublon.
  assert.equal((await events(fy.device, [blocked])).json().accepted[0], blocked.id)

  const { rows } = await ctx.db.query('SELECT phone_enc, phone_index FROM device_events WHERE id = $1', [blocked.id])
  assert.ok(!rows[0].phone_enc.includes(Buffer.from('329876543')), 'numéro chiffré au repos')
  assert.ok(rows[0].phone_index, 'index aveugle posé')

  const list = await calls(member, fy.kid.id)
  assert.equal(list.statusCode, 200, list.body)
  assert.deepEqual(list.json().calls.map((c) => [c.kind, c.phone, c.durationS]), [
    ['call_blocked', null, null],
    ['call_blocked', '+261329876543', null],
    ['call_in', '+261341234567', 75]
  ])
  assert.equal(list.json().calls[2].name, 'Maman')
  assert.deepEqual(Object.keys(list.json().calls[0]).sort(), ['contactId', 'durationS', 'id', 'kind', 'name', 'phone', 'startedAt'])
  assert.deepEqual((await calls(owner, fy.kid.id, '?kind=call_blocked')).json().calls.map((c) => c.id), [hidden.id, blocked.id])
  const { rowCount } = await ctx.db.query('SELECT 1 FROM device_events WHERE id = $1', [blocked.id])
  assert.equal(rowCount, 1)
})

test('formes refusées : bloqué avec contact ou durée, reçu sans numéro E.164', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const bad = [
    { id: randomUUID(), kind: 'call_blocked', contactId: randomUUID(), startedAt: at(1) },
    { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', durationS: 12, startedAt: at(1) },
    { id: randomUUID(), kind: 'call_blocked', name: 'Inconnu', startedAt: at(1) },
    { id: randomUUID(), kind: 'call_in', phone: '0341234567', startedAt: at(1) },
    { id: randomUUID(), kind: 'call_in', startedAt: at(1) }
  ]
  const res = await events(fy.device, bad)
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().rejected.sort(), bad.map((e) => e.id).sort())
  // Contact connu bloqué pendant une plage « école » (NAR-176) : contact, nom et numéro E.164.
  const mamie = (await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Mamie', phone: '032 12 345 67' } })).json()
  const school = { id: randomUUID(), kind: 'call_blocked', contactId: mamie.id, name: 'Mamie', phone: '+261321234567', startedAt: at(1) }
  // Numéro qui n'est pas (ou plus) celui du contact, ou contact inconnu : gardé comme un
  // numéro bloqué ordinaire, sans nom (jamais un numéro quelconque sous le nom de Mamie).
  const otherNumber = { ...school, id: randomUUID(), phone: '+261331111111' }
  const unknownContact = { ...school, id: randomUUID(), contactId: randomUUID() }
  const schoolRes = await events(fy.device, [school, otherNumber, unknownContact,
    { ...school, id: randomUUID(), phone: undefined },
    { ...school, id: randomUUID(), name: undefined }])
  assert.equal(schoolRes.statusCode, 200, schoolRes.body)
  assert.deepEqual(schoolRes.json().accepted, [school.id, otherNumber.id, unknownContact.id])
  const blockedList = (await calls(owner, fy.kid.id, '?kind=call_blocked')).json().calls
  const shape = (id) => { const c = blockedList.find((x) => x.id === id); return [c.contactId, c.name, c.phone] }
  assert.deepEqual(shape(school.id), [mamie.id, 'Mamie', '+261321234567'])
  assert.deepEqual(shape(otherNumber.id), [null, null, '+261331111111'])
  assert.deepEqual(shape(unknownContact.id), [null, null, '+261321234567'])
  // Numéro court reçu tel quel (service, opérateur) : accepté pour un appel bloqué.
  assert.equal((await events(fy.device, [{ id: randomUUID(), kind: 'call_blocked', phone: '321', startedAt: at(1) }])).json().accepted.length, 1)
})

test('fenêtre des secours (NAR-196) : appel reçu marqué, inconnu ou masqué, rendu au calls, au journal et à l’export', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const unknown = { id: randomUUID(), kind: 'call_in', phone: '+261329876543', startedAt: at(3), durationS: 40, emergencyWindow: true }
  const hidden = { id: randomUUID(), kind: 'call_in', startedAt: at(2), durationS: null, emergencyWindow: true }
  const short = { id: randomUUID(), kind: 'call_in', phone: '1515', startedAt: at(1), durationS: null, emergencyWindow: true }
  const res = await events(fy.device, [unknown, hidden, short])
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().accepted, [unknown.id, hidden.id, short.id])
  // Marque réservée aux appels reçus ; sans elle, un appel reçu sans numéro E.164 reste refusé ;
  // marqué avec un contact : numéro E.164 exigé.
  const bad = [
    { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(1), emergencyWindow: true },
    { id: randomUUID(), kind: 'unlock', source: 'code', startedAt: at(1), durationS: 60, emergencyWindow: true },
    { id: randomUUID(), kind: 'call_in', startedAt: at(1), emergencyWindow: false },
    { id: randomUUID(), kind: 'call_in', contactId: randomUUID(), phone: '1515', startedAt: at(1), emergencyWindow: true }
  ]
  assert.deepEqual((await events(fy.device, bad)).json().rejected.sort(), bad.map((e) => e.id).sort())
  // Champ de type inattendu : lot refusé par le schéma.
  assert.equal((await events(fy.device, [{ ...unknown, id: randomUUID(), emergencyWindow: 'oui' }])).statusCode, 400)

  const list = (await calls(owner, fy.kid.id)).json().calls
  assert.deepEqual(list.map((c) => [c.kind, c.phone, c.durationS, c.emergencyWindow]), [
    ['call_in', '1515', null, true],
    ['call_in', null, null, true],
    ['call_in', '+261329876543', 40, true]
  ])
  const items = (await call(ctx.app, 'GET', `/api/children/${fy.kid.id}/journal?kind=calls`, { cookie: owner.cookie })).json().items
  assert.deepEqual(items.map((i) => i.emergencyWindow), [true, true, true])
  // Appel ordinaire : pas de marque (champ absent, réponse inchangée).
  const maman = (await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Maman', phone: '034 12 345 67' } })).json()
  const plain = { id: randomUUID(), kind: 'call_in', contactId: maman.id, name: 'Maman', phone: '+261341234567', startedAt: at(0.5), durationS: 5 }
  assert.equal((await events(fy.device, [plain])).json().accepted[0], plain.id)
  const first = (await calls(owner, fy.kid.id)).json().calls[0]
  assert.equal(first.id, plain.id)
  assert.equal('emergencyWindow' in first, false)
  const { rows } = await ctx.db.query('SELECT emergency_window FROM device_events WHERE id = ANY($1::uuid[]) ORDER BY started_at', [[unknown.id, plain.id]])
  assert.deepEqual(rows.map((r) => r.emergency_window), [true, false])
  const exported = (await call(ctx.app, 'GET', '/api/families/me/export', { cookie: owner.cookie })).json()
  const journal = JSON.stringify(exported)
  assert.ok(journal.includes('"emergencyWindow":true'), 'marque exportée')
})

test('cloisonnement : le téléphone de X n’écrit pas chez Y ; A/B → 404 ; contact, pas d’accès à un autre enfant', async () => {
  const a = await newUser(ctx)
  await family(a)
  const x = await pairedChild(a, 'Fy')
  const b = await newUser(ctx)
  await family(b)
  const y = await pairedChild(b, 'Hery')
  const theirs = (await call(ctx.app, 'POST', `/api/children/${y.kid.id}/contacts`, { cookie: b.cookie, body: { name: 'Papa', phone: '033 12 345 67' } })).json()

  // Contact d'un autre enfant cité par le téléphone de X : refusé.
  const forged = { id: randomUUID(), kind: 'call_in', contactId: theirs.id, phone: '+261331234567', startedAt: at(1) }
  assert.deepEqual((await events(x.device, [forged])).json().rejected, [forged.id])
  const forgedBlock = { id: randomUUID(), kind: 'call_blocked', contactId: theirs.id, name: 'Papa', phone: '+261331234567', startedAt: at(1) }
  assert.deepEqual((await events(x.device, [forgedBlock])).json().rejected, [forgedBlock.id])
  const mine = { id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(1) }
  await events(x.device, [mine])
  // Même identifiant envoyé par Y : refusé, rien chez Y.
  assert.deepEqual((await events(y.device, [mine])).json().rejected, [mine.id])
  assert.equal((await calls(b, y.kid.id)).json().calls.length, 0)

  assert.equal((await calls(b, x.kid.id)).statusCode, 404)
  assert.equal((await calls(b, randomUUID())).statusCode, 404)
  assert.equal((await call(ctx.app, 'GET', `/api/children/${x.kid.id}/calls`)).statusCode, 401)
  // Admin de la plateforme, sans famille : aucun accès au journal.
  const admin = await newUser(ctx, { admin: true })
  assert.ok([403, 404].includes((await calls(admin, x.kid.id)).statusCode))
})

test('pagination par curseur : ni doublon ni trou quand des appels arrivent pendant la lecture', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const batch = Array.from({ length: 55 }, (_, i) => ({ id: randomUUID(), kind: 'call_blocked', phone: '+261329876543', startedAt: at(100 - i) }))
  assert.equal((await events(fy.device, batch.slice(0, 50))).statusCode, 200)
  await events(fy.device, batch.slice(50))
  const first = (await calls(owner, fy.kid.id)).json()
  assert.equal(first.calls.length, 50)
  assert.ok(first.next)
  // Nouvel appel entre deux pages : il n'apparaît pas dans la page suivante, rien n'est sauté.
  await events(fy.device, [{ id: randomUUID(), kind: 'call_blocked', phone: '+261320000000', startedAt: at(0) }])
  const second = (await calls(owner, fy.kid.id, `?before=${encodeURIComponent(first.next)}`)).json()
  const seen = [...first.calls, ...second.calls].map((c) => c.id)
  assert.equal(new Set(seen).size, 55)
  assert.deepEqual(new Set(seen), new Set(batch.map((e) => e.id)))
  assert.equal(second.next, null)
})
