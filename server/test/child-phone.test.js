// Numéro de téléphone de l'enfant (NAR-194) : chiffré, validé comme celui d'un contact,
// écrit par un gestionnaire seul, lu par tous les membres, exporté, effacé avec l'enfant.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser, tokenIn } from './helpers.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000' }) })
after(async () => { await ctx.close(); dbh.stop() })

const family = async (u, name = 'Famille') => (await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name } })).json()
const add = (u, body) => call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { parentalConsent: true, firstName: 'Fy', ...body } })
const list = (u) => call(ctx.app, 'GET', '/api/children', { cookie: u.cookie })
const patch = (u, id, body) => call(ctx.app, 'PATCH', `/api/children/${id}`, { cookie: u.cookie, body })
const phoneOf = async (u, id) => (await list(u)).json().find((c) => c.id === id)?.phone
const raw = async (id) => (await ctx.db.query('SELECT phone_enc FROM children WHERE id = $1', [id])).rows[0]?.phone_enc

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  assert.equal((await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })).statusCode, 200)
  return guest
}

test('numéro : saisi à l’ajout, modifié et effacé par un gestionnaire, lu par tous les membres', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager'), member = await join(owner, 'member')
  const fy = await add(owner, { phone: '034 12 345 67' })
  assert.equal(fy.statusCode, 201, fy.body)
  assert.equal(fy.json().phone, '+261341234567')
  // Sans numéro : null, jamais une chaîne vide.
  const tiana = (await add(owner, { firstName: 'Tiana' })).json()
  assert.equal(tiana.phone, null)
  // Un contact (member) le lit : il appelle aussi l'enfant.
  assert.equal(await phoneOf(member, fy.json().id), '+261341234567')
  const changed = await patch(manager, fy.json().id, { phone: '+33 6 12 34 56 78' })
  assert.equal(changed.statusCode, 200, changed.body)
  assert.equal(changed.json().phone, '+33612345678')
  assert.equal(await phoneOf(member, fy.json().id), '+33612345678')
  // Changer le prénom seul ne touche pas au numéro.
  assert.equal((await patch(owner, fy.json().id, { firstName: 'Fyfy' })).json().phone, '+33612345678')
  const cleared = await patch(owner, fy.json().id, { phone: null })
  assert.equal(cleared.statusCode, 200)
  assert.equal(cleared.json().phone, null)
  assert.equal(await raw(fy.json().id), null)
})

test('numéro invalide → 400 invalid_phone (même règle que les contacts), rien d’écrit', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = (await add(owner, { phone: '0341234567' })).json()
  const before = await raw(fy.id)
  for (const phone of ['', '   ', '123', 'abc', '0412345678', '+0123456789', '+1234567', '+1234567890123456', '034 12 345 67 8']) {
    const res = await patch(owner, fy.id, { phone })
    assert.equal(res.statusCode, 400, `${phone} : ${res.body}`)
    assert.equal(res.json().code, 'invalid_phone')
  }
  for (const phone of [341234567, ['0341234567'], { n: 1 }, '0'.repeat(41)]) assert.equal((await patch(owner, fy.id, { phone })).statusCode, 400)
  assert.equal((await add(owner, { firstName: 'Hery', phone: '12' })).json().code, 'invalid_phone')
  assert.equal((await list(owner)).json().length, 1, 'aucun enfant ajouté avec un numéro invalide')
  assert.deepEqual(await raw(fy.id), before)
  // Champ inconnu : 400 (additionalProperties: false), y compris la colonne chiffrée.
  assert.equal((await patch(owner, fy.id, { phone_enc: 'x' })).statusCode, 400)
  assert.equal((await patch(owner, fy.id, { phoneNumber: '0341234567' })).statusCode, 400)
})

test('un contact (member) ne modifie pas le numéro : 403, numéro valide ou non ; rien d’écrit', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = (await add(owner, { phone: '0341234567' })).json()
  for (const phone of ['0331234567', null, 'pas un numéro']) assert.equal((await patch(member, fy.id, { phone })).statusCode, 403)
  assert.equal((await add(member, { phone: '0331234567' })).statusCode, 403)
  assert.equal(await phoneOf(owner, fy.id), '+261341234567')
})

test('A ne lit ni ne modifie le numéro de l’enfant de B (404)', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  await family(a, 'A'); await family(b, 'B')
  const childB = (await add(b, { phone: '0341234567' })).json()
  assert.deepEqual((await list(a)).json(), [])
  assert.equal((await patch(a, childB.id, { phone: '0331234567' })).statusCode, 404)
  assert.equal((await patch(a, childB.id, { phone: null })).statusCode, 404)
  assert.equal(await phoneOf(b, childB.id), '+261341234567')
  // Sans famille : 404 ; sans session : 401.
  const lone = await newUser(ctx)
  assert.equal((await patch(lone, childB.id, { phone: null })).statusCode, 404)
  assert.equal((await call(ctx.app, 'PATCH', `/api/children/${childB.id}`, { body: { phone: null } })).statusCode, 401)
})

test('le numéro est chiffré en base, lié à sa ligne, et absent du journal d’audit', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const a = (await add(owner, { phone: '0341234567' })).json(), b = (await add(owner, { firstName: 'Tiana', phone: '0341234567' })).json()
  const ea = await raw(a.id), eb = await raw(b.id)
  for (const enc of [ea, eb]) {
    assert.ok(Buffer.isBuffer(enc))
    for (const plain of ['+261341234567', '261341234567', '341234567', '0341234567']) assert.ok(!enc.includes(Buffer.from(plain)), plain)
  }
  assert.notDeepEqual(ea, eb, 'un chiffré propre à chaque ligne')
  const { rows: audit } = await ctx.db.query('SELECT details::text AS d FROM audit_log WHERE target = ANY($1)', [[a.id, b.id]])
  assert.ok(audit.length > 0 && audit.every((r) => !String(r.d).includes('341234567')))
  // Chiffré recopié sur un autre enfant : illisible (données associées « children:phone:<id> »).
  await ctx.db.query('UPDATE children SET phone_enc = $1 WHERE id = $2', [ea, b.id])
  assert.equal((await list(owner)).statusCode, 500)
  // Chiffré du prénom recopié dans la colonne du numéro : illisible aussi (colonne dans les données associées).
  await ctx.db.query('UPDATE children SET phone_enc = first_name_enc WHERE id = $1', [b.id])
  assert.equal((await list(owner)).statusCode, 500)
})

test('export : numéro de l’enfant ouvert (null sans numéro) ; retrait de l’enfant puis de la famille : plus rien', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = (await add(owner, { phone: '0341234567' })).json()
  const tiana = (await add(owner, { firstName: 'Tiana' })).json()
  const res = await call(ctx.app, 'GET', '/api/families/me/export', { cookie: owner.cookie })
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().children.map((c) => [c.firstName, c.phone]), [['Fy', '+261341234567'], ['Tiana', null]])
  assert.ok(!res.body.includes('phone_enc') && !('unreadableFields' in res.json()))
  // Retrait de l'enfant : la ligne et son numéro chiffré disparaissent.
  assert.equal((await call(ctx.app, 'DELETE', `/api/children/${fy.id}`, { cookie: owner.cookie })).statusCode, 200)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM children WHERE id = $1', [fy.id])).rows[0].n, 0)
  // Suppression de la famille (owner, mot de passe redemandé) : les autres enfants aussi.
  await patch(owner, tiana.id, { phone: '0331234567' })
  assert.equal((await call(ctx.app, 'DELETE', '/api/families/me', { cookie: owner.cookie, body: { password: owner.password } })).statusCode, 200)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM children WHERE id = $1', [tiana.id])).rows[0].n, 0)
})
