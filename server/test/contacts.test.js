import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser, tokenIn } from './helpers.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000' }) })
after(async () => { await ctx.close(); dbh.stop() })

const family = async (u, name = 'Famille') => (await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name } })).json()
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { firstName } })).json()
const list = (u, childId) => call(ctx.app, 'GET', `/api/children/${childId}/contacts`, { cookie: u.cookie })
const add = (u, childId, name, phone, extra = {}) => call(ctx.app, 'POST', `/api/children/${childId}/contacts`, { cookie: u.cookie, body: { name, phone, ...extra } })
const patch = (u, id, body) => call(ctx.app, 'PATCH', `/api/contacts/${id}`, { cookie: u.cookie, body })
const del = (u, id) => call(ctx.app, 'DELETE', `/api/contacts/${id}`, { cookie: u.cookie })
const order = (u, childId, ids) => call(ctx.app, 'PUT', `/api/children/${childId}/contacts/order`, { cookie: u.cookie, body: { ids } })
const phone = (n) => `034 00 ${String(n).padStart(3, '0')} ${String(10 + n).slice(-2)}`

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}

test('un gestionnaire ajoute 4 contacts, les réordonne ; jusqu’à 6, le 7e est refusé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const manager = await join(owner, 'manager')
  const ids = []
  for (const [i, name] of ['Maman', 'Papa', 'Mamie', 'Tonton Hery'].entries()) {
    const r = await add(manager, fy.id, name, phone(i))
    assert.equal(r.statusCode, 201, r.body)
    assert.equal(r.json().position, i + 1)
    ids.push(r.json().id)
  }
  const first = (await list(owner, fy.id)).json()
  assert.equal(first.max, 6)
  assert.equal(first.contacts[0].phone, '+261340000010')
  assert.equal((await order(manager, fy.id, [ids[3], ids[0], ids[2], ids[1]])).statusCode, 200)
  const after = (await list(owner, fy.id)).json()
  assert.deepEqual(after.contacts.map((c) => c.name), ['Tonton Hery', 'Maman', 'Mamie', 'Papa'])
  assert.deepEqual(after.contacts.map((c) => c.position), [1, 2, 3, 4])
  assert.ok(after.version > first.version, 'la version avance à chaque changement')
  await add(owner, fy.id, 'Cinq', phone(5)); await add(owner, fy.id, 'Six', phone(6))
  const seventh = await add(owner, fy.id, 'Sept', phone(7))
  assert.equal(seventh.statusCode, 409)
  assert.equal(seventh.json().code, 'too_many_contacts')
})

test('ajouts simultanés au-delà du plafond : jamais plus de 6, positions sans doublon', async () => {
  for (let round = 0; round < 4; round++) {
    const owner = await newUser(ctx)
    await family(owner)
    const fy = await child(owner)
    for (let i = 0; i < 2; i++) await add(owner, fy.id, `C${i}`, phone(i))
    const results = await Promise.all([10, 11, 12, 13, 14, 15, 16].map((n) => add(owner, fy.id, `D${n}`, phone(n))))
    // Sous le verrou de l'enfant : exactement 4 ajouts, les autres refusés pour le plafond.
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 201, 201, 201, 409, 409, 409])
    assert.ok(results.filter((r) => r.statusCode === 409).every((r) => r.json().code === 'too_many_contacts'))
    assert.deepEqual((await list(owner, fy.id)).json().contacts.map((c) => c.position), [1, 2, 3, 4, 5, 6])
  }
})

test('numéro et nom chiffrés au repos ; même numéro (autre écriture) pour le même enfant → 409', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner), tiana = await child(owner, 'Tiana')
  const c = (await add(owner, fy.id, 'Maman', '034 12 345 67')).json()
  const { rows: [row] } = await ctx.db.query('SELECT name_enc, phone_enc, phone_index FROM allowed_contacts WHERE id = $1', [c.id])
  for (const col of [row.name_enc, row.phone_enc, row.phone_index]) {
    assert.ok(!col.includes(Buffer.from('Maman')) && !col.includes(Buffer.from('341234567')))
  }
  const dup = await add(owner, fy.id, 'Encore Maman', '+261 34 12 345 67')
  assert.equal(dup.statusCode, 409)
  assert.equal(dup.json().code, 'duplicate_phone')
  // Même numéro pour un autre enfant : permis.
  assert.equal((await add(owner, tiana.id, 'Maman', '0341234567')).statusCode, 201)
  // Modifier vers un numéro déjà pris : 409 aussi.
  const papa = (await add(owner, fy.id, 'Papa', phone(1))).json()
  assert.equal((await patch(owner, papa.id, { phone: '034 12 345 67' })).statusCode, 409)
  const { rows: audit } = await ctx.db.query("SELECT details::text AS d FROM audit_log WHERE action LIKE 'contact_%'")
  assert.ok(audit.every((r) => !String(r.d).includes('Maman') && !String(r.d).includes('34123')), 'ni nom ni numéro dans l’audit')
})

test('contact : lit les contacts, n’écrit rien (403)', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const c = (await add(owner, fy.id, 'Maman', phone(1))).json()
  const member = await join(owner, 'member')
  assert.equal((await list(member, fy.id)).json().contacts.length, 1)
  assert.equal((await add(member, fy.id, 'Intrus', phone(2))).statusCode, 403)
  assert.equal((await patch(member, c.id, { name: 'X' })).statusCode, 403)
  assert.equal((await del(member, c.id)).statusCode, 403)
  assert.equal((await order(member, fy.id, [c.id])).statusCode, 403)
})

test('A ne lit ni ne touche les contacts de B : enfant ou contact d’une autre famille → 404', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  await family(a, 'A'); await family(b, 'B')
  const childA = await child(a), childB = await child(b)
  const cB = (await add(b, childB.id, 'Maman B', phone(1))).json()
  assert.equal((await list(a, childB.id)).statusCode, 404)
  assert.equal((await add(a, childB.id, 'Intrus', phone(2))).statusCode, 404)
  assert.equal((await patch(a, cB.id, { name: 'Volé' })).statusCode, 404)
  assert.equal((await del(a, cB.id)).statusCode, 404)
  assert.equal((await order(a, childB.id, [cB.id])).statusCode, 404)
  // Contact de B glissé dans l'ordre de l'enfant de A : refusé.
  assert.equal((await order(a, childA.id, [cB.id])).statusCode, 409)
  assert.deepEqual((await list(b, childB.id)).json().contacts.map((c) => c.name), ['Maman B'])
  assert.equal((await list(a, 'pas-un-uuid')).statusCode, 404)
})

test('membre lié : de la même famille seulement, son rôle s’affiche, délié s’il quitte la famille', async () => {
  const owner = await newUser(ctx), stranger = await newUser(ctx)
  await family(owner); await family(stranger, 'Ailleurs')
  const fy = await child(owner)
  const manager = await join(owner, 'manager')
  const c = await add(owner, fy.id, 'Papa', phone(1), { memberUserId: manager.id })
  assert.equal(c.statusCode, 201, c.body)
  assert.equal(c.json().memberRole, 'manager')
  assert.equal((await add(owner, fy.id, 'Intrus', phone(2), { memberUserId: stranger.id })).json().code, 'member_not_found')
  await call(ctx.app, 'DELETE', `/api/families/me/members/${manager.id}`, { cookie: owner.cookie })
  const after = (await list(owner, fy.id)).json().contacts[0]
  assert.equal(after.memberUserId, null)
  assert.equal(after.name, 'Papa', 'le contact reste, seul le lien disparaît')
})

test('retrait : positions recomptées sans trou ; ordre incomplet ou en double refusé', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  const ids = []
  for (let i = 0; i < 3; i++) ids.push((await add(owner, fy.id, `C${i}`, phone(i))).json().id)
  assert.equal((await del(owner, ids[0])).statusCode, 200)
  assert.deepEqual((await list(owner, fy.id)).json().contacts.map((c) => [c.name, c.position]), [['C1', 1], ['C2', 2]])
  assert.equal((await order(owner, fy.id, [ids[1]])).json().code, 'order_mismatch')
  assert.equal((await order(owner, fy.id, [ids[1], ids[1]])).statusCode, 409)
  assert.equal((await order(owner, fy.id, [ids[2], ids[0]])).statusCode, 409)
})

test('entrées : nom, numéro, couleur, champs imposés', async () => {
  const owner = await newUser(ctx), other = await newUser(ctx)
  await family(owner); await family(other, 'Autre')
  const fy = await child(owner), childOther = await child(other)
  assert.equal((await add(owner, fy.id, '', phone(1))).statusCode, 400)
  assert.equal((await add(owner, fy.id, 'x'.repeat(41), phone(1))).statusCode, 400)
  assert.equal((await add(owner, fy.id, 'Maman', '12')).json().code, 'invalid_phone')
  assert.equal((await add(owner, fy.id, 'Maman', phone(1), { avatarColor: 'red' })).statusCode, 400)
  for (const extra of [{ childId: childOther.id }, { family_id: fy.id }, { position: 1 }]) {
    assert.equal((await add(owner, fy.id, 'Maman', phone(1), extra)).statusCode, 400)
  }
  const c = (await add(owner, fy.id, 'Maman', phone(1))).json()
  assert.equal((await patch(owner, c.id, {})).statusCode, 400)
  assert.equal((await patch(owner, c.id, { position: 3 })).statusCode, 400)
})

test('enfant retiré : ses contacts aussi (cascade)', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await child(owner)
  await add(owner, fy.id, 'Maman', phone(1))
  await call(ctx.app, 'DELETE', `/api/children/${fy.id}`, { cookie: owner.cookie })
  const { rows: [{ n }] } = await ctx.db.query('SELECT count(*)::int AS n FROM allowed_contacts WHERE child_id = $1', [fy.id])
  assert.equal(n, 0)
})
