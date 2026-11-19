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
const send = (device, body) => native(ctx.app, 'POST', '/api/device/messages', { token: device.accessToken, body })
const phoneList = (device) => native(ctx.app, 'GET', '/api/device/messages', { token: device.accessToken })
const list = (u, childId) => call(ctx.app, 'GET', `/api/children/${childId}/messages`, { cookie: u.cookie })
const read = (u, id) => call(ctx.app, 'POST', `/api/messages/${id}/read`, { cookie: u.cookie })

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
const now = () => new Date().toISOString()

test('le téléphone envoie un message ; les membres le voient ; « vu par » revient au téléphone, nom du contact lié', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  // Le parent principal est lié au contact « Maman » : c'est ce nom que l'enfant voit.
  const me = (await call(ctx.app, 'GET', '/api/auth/me', { cookie: owner.cookie })).json().user
  assert.equal((await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body: { name: 'Maman', phone: '034 12 345 67', memberUserId: me.id } })).statusCode, 201)

  const id = randomUUID()
  const sent = await send(fy.device, { id, slot: 1, sentAt: now() })
  assert.equal(sent.statusCode, 200, sent.body)
  // Rejoué (file hors ligne) : une seule fois.
  assert.equal((await send(fy.device, { id, slot: 1, sentAt: now() })).statusCode, 200)
  const { rowCount } = await ctx.db.query('SELECT 1 FROM quick_messages WHERE id = $1', [id])
  assert.equal(rowCount, 1)

  const seen = await list(member, fy.kid.id)
  assert.equal(seen.statusCode, 200, seen.body)
  assert.deepEqual(seen.json().map((m) => [m.id, m.slot, m.readBy.length, m.readByMe]), [[id, 1, 0, false]])

  assert.equal((await read(owner, id)).statusCode, 200)
  assert.equal((await read(owner, id)).statusCode, 200, 'idempotent')
  const after = (await list(owner, fy.kid.id)).json()[0]
  assert.equal(after.readByMe, true)
  assert.deepEqual(after.readBy.map((r) => r.name), ['Maman'])

  const onPhone = (await phoneList(fy.device)).json()
  assert.equal(onPhone[0].id, id)
  assert.deepEqual(onPhone[0].readBy.map((r) => r.name), ['Maman'])
  assert.deepEqual(Object.keys(onPhone[0].readBy[0]).sort(), ['name', 'readAt'], 'ni identifiant ni adresse de compte')
})

test('envoi : emplacement 1 à 4, champs connus seulement, date plausible', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  for (const body of [
    { id: randomUUID(), slot: 0, sentAt: now() },
    { id: randomUUID(), slot: 5, sentAt: now() },
    { id: randomUUID(), slot: 1, sentAt: now(), text: 'message libre' },
    { id: 'pas-un-uuid', slot: 1, sentAt: now() }
  ]) assert.equal((await send(fy.device, body)).statusCode, 400, JSON.stringify(body))
  assert.equal((await native(ctx.app, 'POST', '/api/device/messages', { body: { id: randomUUID(), slot: 1, sentAt: now() } })).statusCode, 401)
  // Horloge du téléphone remise à zéro : le message est gardé, à l'heure de réception.
  const id = randomUUID()
  assert.equal((await send(fy.device, { id, slot: 4, sentAt: '2000-01-01T00:00:00Z' })).statusCode, 200)
  const { rows: [row] } = await ctx.db.query('SELECT sent_at FROM quick_messages WHERE id = $1', [id])
  assert.ok(Math.abs(row.sent_at.getTime() - Date.now()) < 60_000)
})

test('cloisonnement : un téléphone n’envoie que pour son enfant ; A/B → 404 en lecture et pour « vu »', async () => {
  const a = await newUser(ctx)
  await family(a)
  const x = await pairedChild(a, 'Fy')
  const b = await newUser(ctx)
  await family(b)
  const y = await pairedChild(b, 'Hery')

  const id = randomUUID()
  await send(x.device, { id, slot: 2, sentAt: now() })
  // Même identifiant par le téléphone d'une autre famille : refusé, rien chez elle.
  assert.equal((await send(y.device, { id, slot: 2, sentAt: now() })).statusCode, 409)
  assert.equal((await list(b, y.kid.id)).json().length, 0)
  assert.equal((await phoneList(y.device)).json().length, 0)

  assert.equal((await list(b, x.kid.id)).statusCode, 404)
  assert.equal((await read(b, id)).statusCode, 404)
  assert.equal((await read(b, randomUUID())).statusCode, 404)
  const { rowCount } = await ctx.db.query('SELECT 1 FROM quick_message_reads WHERE message_id = $1', [id])
  assert.equal(rowCount, 0)
  assert.equal((await call(ctx.app, 'GET', `/api/children/${x.kid.id}/messages`)).statusCode, 401)
})
