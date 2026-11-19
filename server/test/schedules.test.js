import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const SCHOOL = { label: 'École', days: 0b0011111, startMin: 8 * 60, endMin: 16 * 60 }
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const list = (u, id) => call(ctx.app, 'GET', `/api/children/${id}/schedules`, { cookie: u.cookie })
const create = (u, id, body) => call(ctx.app, 'POST', `/api/children/${id}/schedules`, { cookie: u.cookie, body })
const update = (u, id, sid, body) => call(ctx.app, 'PUT', `/api/children/${id}/schedules/${sid}`, { cookie: u.cookie, body })
const remove = (u, id, sid) => call(ctx.app, 'DELETE', `/api/children/${id}/schedules/${sid}`, { cookie: u.cookie })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })

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
const me = async (u) => (await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user

test('un gestionnaire crée, modifie, désactive et supprime une plage ; le téléphone la reçoit avec les contacts « parents »', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  // Maman (owner) et Papa (manager) sont parents ; Mamie (contact sans compte) et Tonton (member) non.
  for (const [name, phone, user] of [['Maman', '034 11 111 11', owner], ['Papa', '034 22 222 22', manager], ['Mamie', '034 33 333 33', null], ['Tonton', '034 44 444 44', member]]) {
    const body = { name, phone, ...(user ? { memberUserId: (await me(user)).id } : {}) }
    assert.equal((await call(ctx.app, 'POST', `/api/children/${fy.kid.id}/contacts`, { cookie: owner.cookie, body })).statusCode, 201)
  }
  const first = await config(fy.device)
  assert.deepEqual(first.json().schedules, [])
  assert.equal(first.json().timezone, 'Indian/Antananarivo')
  assert.deepEqual(first.json().contacts.map((c) => [c.name, c.parent]), [['Maman', true], ['Papa', true], ['Mamie', false], ['Tonton', false]])
  assert.deepEqual(Object.keys(first.json().contacts[0]).sort(), ['avatarColor', 'id', 'name', 'parent', 'phone', 'position'], 'ni membre ni rôle')

  const made = await create(manager, fy.kid.id, SCHOOL)
  assert.equal(made.statusCode, 201, made.body)
  const s = made.json()
  assert.deepEqual({ ...s, id: undefined }, { ...SCHOOL, id: undefined, enabled: true })
  const after = await config(fy.device, first.headers.etag)
  assert.equal(after.statusCode, 200, 'une plage ajoutée invalide le 304')
  assert.deepEqual(after.json().schedules, [{ label: 'École', days: SCHOOL.days, startMin: 480, endMin: 960 }])
  assert.deepEqual((await list(member, fy.kid.id)).json().map((x) => x.label), ['École'])

  // Chiffré au repos.
  const { rows: [row] } = await ctx.db.query('SELECT label_enc FROM schedules WHERE id = $1', [s.id])
  assert.ok(!row.label_enc.includes(Buffer.from('École')))

  // Plage de nuit (traverse minuit), puis désactivée : plus envoyée au téléphone.
  assert.equal((await update(owner, fy.kid.id, s.id, { ...SCHOOL, label: 'Nuit', startMin: 21 * 60, endMin: 7 * 60, enabled: true })).json().endMin, 420)
  assert.equal((await update(owner, fy.kid.id, s.id, { ...SCHOOL, enabled: false })).json().enabled, false)
  assert.deepEqual((await config(fy.device)).json().schedules, [])
  assert.equal((await list(owner, fy.kid.id)).json()[0].enabled, false)

  // Tonton devient gestionnaire : il passe parent sur le téléphone (version avancée).
  const etag = (await config(fy.device)).headers.etag
  const tonton = await me(member)
  assert.equal((await call(ctx.app, 'PATCH', `/api/families/me/members/${tonton.id}`, { cookie: owner.cookie, body: { role: 'manager' } })).statusCode, 200)
  const promoted = await config(fy.device, etag)
  assert.equal(promoted.statusCode, 200)
  assert.equal(promoted.json().contacts.find((c) => c.name === 'Tonton').parent, true)

  // Fuseau de la famille changé (opération d'exploitation) : nouvelle version.
  const etag2 = (await config(fy.device)).headers.etag
  await ctx.db.query("UPDATE families SET timezone = 'Europe/Paris' WHERE id = (SELECT family_id FROM children WHERE id = $1)", [fy.kid.id])
  const moved = await config(fy.device, etag2)
  assert.equal(moved.statusCode, 200)
  assert.equal(moved.json().timezone, 'Europe/Paris')

  assert.equal((await remove(manager, fy.kid.id, s.id)).statusCode, 200)
  assert.deepEqual((await list(owner, fy.kid.id)).json(), [])
  assert.equal((await remove(manager, fy.kid.id, s.id)).statusCode, 404)
})

test('droits et validation : contact 403 quoi qu’il envoie, autre famille 404, valeurs refusées, 10 plages au plus', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
  for (const body of [SCHOOL, {}, { ...SCHOOL, days: 0 }]) assert.equal((await create(member, kid.id, body)).statusCode, 403)
  const s = (await create(owner, kid.id, SCHOOL)).json()
  assert.equal((await update(member, kid.id, s.id, { ...SCHOOL, enabled: true })).statusCode, 403)
  assert.equal((await remove(member, kid.id, s.id)).statusCode, 403)

  const stranger = await newUser(ctx)
  await family(stranger)
  const theirs = (await call(ctx.app, 'POST', '/api/children', { cookie: stranger.cookie, body: { parentalConsent: true, firstName: 'Hery' } })).json()
  assert.equal((await list(stranger, kid.id)).statusCode, 404)
  assert.equal((await create(stranger, kid.id, SCHOOL)).statusCode, 404)
  assert.equal((await update(stranger, kid.id, s.id, { ...SCHOOL, enabled: true })).statusCode, 404)
  assert.equal((await remove(stranger, kid.id, s.id)).statusCode, 404)
  // Plage de A visée à travers l'enfant de B : introuvable, intacte.
  assert.equal((await update(stranger, theirs.id, s.id, { ...SCHOOL, label: 'Piraté', enabled: true })).statusCode, 404)
  assert.equal((await remove(stranger, theirs.id, s.id)).statusCode, 404)
  assert.equal((await list(owner, kid.id)).json()[0].label, 'École')

  for (const body of [
    { ...SCHOOL, days: 0 }, { ...SCHOOL, days: 128 }, { ...SCHOOL, startMin: 1440 }, { ...SCHOOL, endMin: -1 },
    { ...SCHOOL, startMin: 600, endMin: 600 }, { ...SCHOOL, startMin: 8.5 }, { ...SCHOOL, label: '' }, { ...SCHOOL, label: 'x'.repeat(31) },
    { ...SCHOOL, enabled: 'oui' }, { ...SCHOOL, childId: randomUUID() }, { label: 'École' }
  ]) assert.equal((await create(owner, kid.id, body)).statusCode, 400, JSON.stringify(body))
  assert.equal((await update(owner, kid.id, randomUUID(), { ...SCHOOL, enabled: true })).statusCode, 404)
  // Remplacement sans « enabled » : refusé (une plage désactivée ne se réactive pas par oubli).
  assert.equal((await update(owner, kid.id, s.id, SCHOOL)).statusCode, 400)

  for (let i = 1; i < 10; i++) assert.equal((await create(owner, kid.id, { ...SCHOOL, label: `P${i}` })).statusCode, 201)
  assert.equal((await create(owner, kid.id, SCHOOL)).statusCode, 409)
  assert.equal((await call(ctx.app, 'GET', `/api/children/${kid.id}/schedules`)).statusCode, 401)
})
