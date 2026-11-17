import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser, tokenIn } from './helpers.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url) })
after(async () => { await ctx.close(); dbh.stop() })

const family = async (u, name = 'Famille Rabe') => (await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name } })).json()
const invite = (u, email, role = 'member') => call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: u.cookie, body: { email, role } })
const pending = (u) => call(ctx.app, 'GET', '/api/families/me/invitations', { cookie: u.cookie })
const accept = (u, token) => call(ctx.app, 'POST', '/api/invitations/accept', { cookie: u.cookie, body: { token } })
const preview = (u, token) => call(ctx.app, 'POST', '/api/invitations/preview', { cookie: u.cookie, body: { token } })
const setRole = (u, userId, role) => call(ctx.app, 'PATCH', `/api/families/me/members/${userId}`, { cookie: u.cookie, body: { role } })
const remove = (u, userId) => call(ctx.app, 'DELETE', `/api/families/me/members/${userId}`, { cookie: u.cookie })
const members = async (u) => (await call(ctx.app, 'GET', '/api/families/me', { cookie: u.cookie })).json().members
const tokenFor = (email) => tokenIn(ctx.sent.findLast((m) => m.to === email && m.text.includes('#invite=')), 'invite')

// Invite puis fait accepter : renvoie le membre ajouté.
async function join(owner, role = 'member') {
  const guest = await newUser(ctx)
  assert.equal((await invite(owner, guest.email, role)).statusCode, 201)
  assert.equal((await accept(guest, tokenFor(guest.email))).statusCode, 200)
  return guest
}

test('cycle complet : invitation, courriel, aperçu, acceptation comme contact', async () => {
  const owner = await newUser(ctx), guest = await newUser(ctx)
  await family(owner, 'Famille Andria')
  const r = await invite(owner, `  ${guest.email.toUpperCase()} `, 'member')
  assert.equal(r.statusCode, 201, r.body)
  assert.equal(r.json().email, guest.email)
  const mail = ctx.sent.findLast((m) => m.to === guest.email)
  assert.match(mail.text, /\/invitation#invite=[A-Za-z0-9_-]{43}/)
  assert.doesNotMatch(mail.text, /Andria/, 'aucun texte libre de l’invitant dans le courriel')
  const token = tokenFor(guest.email)
  assert.deepEqual((await preview(guest, token)).json(), { forThisAccount: true, familyName: 'Famille Andria', role: 'member' })
  const ok = await accept(guest, token)
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal(ok.json().role, 'member')
  assert.deepEqual((await members(owner)).map((m) => m.role), ['owner', 'member'])
  assert.deepEqual((await pending(owner)).json(), [])
  const { rows } = await ctx.db.query("SELECT token_hash FROM invitations WHERE email = $1", [guest.email])
  assert.ok(!rows[0].token_hash.toString('utf8').includes(token), 'jeton stocké haché')
})

test('jeton rejoué ou utilisé deux fois en parallèle : un seul succès', async () => {
  const owner = await newUser(ctx), guest = await newUser(ctx)
  await family(owner)
  await invite(owner, guest.email)
  const token = tokenFor(guest.email)
  const results = await Promise.all([accept(guest, token), accept(guest, token), accept(guest, token)])
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400, 400])
  assert.equal((await accept(guest, token)).statusCode, 400)
  assert.equal((await members(owner)).length, 2)
})

test('jeton accepté par un autre compte que l’adresse invitée : refus', async () => {
  const owner = await newUser(ctx), guest = await newUser(ctx), thief = await newUser(ctx)
  await family(owner)
  await invite(owner, guest.email)
  const token = tokenFor(guest.email)
  assert.deepEqual((await preview(thief, token)).json(), { forThisAccount: false })
  const refused = await accept(thief, token)
  assert.equal(refused.statusCode, 403)
  assert.equal(refused.json().code, 'invite_other_account')
  assert.equal((await members(owner)).length, 1)
  assert.equal((await accept(guest, token)).statusCode, 200, 'le refus ne consomme pas le jeton')
  assert.equal((await call(ctx.app, 'POST', '/api/invitations/accept', { body: { token } })).statusCode, 401)
})

test('jeton expiré, inconnu, ou invitant qui n’est plus gestionnaire : refus', async () => {
  const owner = await newUser(ctx), manager = await join(await (async () => { await family(owner); return owner })(), 'manager')
  const a = await newUser(ctx), b = await newUser(ctx)
  await invite(owner, a.email)
  await ctx.db.query("UPDATE invitations SET expires_at = now() - interval '1 second' WHERE email = $1", [a.email])
  assert.equal((await accept(a, tokenFor(a.email))).json().code, 'invite_invalid')
  assert.equal((await accept(a, 'x'.repeat(43))).statusCode, 400)
  await invite(manager, b.email)
  await setRole(owner, manager.id, 'member')
  assert.equal((await accept(b, tokenFor(b.email))).json().code, 'invite_invalid')
})

test('un compte qui a déjà une famille ne peut pas en rejoindre une autre', async () => {
  const owner = await newUser(ctx), other = await newUser(ctx)
  await family(owner); await family(other, 'Autre')
  await invite(owner, other.email)
  const r = await accept(other, tokenFor(other.email))
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'already_in_family')
})

test('règles d’invitation : rôle owner impossible, contact refusé, déjà membre, plafond, remplacement', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const contact = await join(owner, 'member')
  const manager = await join(owner, 'manager')
  assert.equal((await invite(owner, 'x@exemple.fr', 'owner')).statusCode, 400)
  assert.equal((await invite(manager, 'y@exemple.fr', 'owner')).statusCode, 400)
  assert.equal((await invite(manager, 'y@exemple.fr', 'manager')).statusCode, 201)
  assert.equal((await invite(contact, 'z@exemple.fr')).statusCode, 403)
  assert.equal((await pending(contact)).statusCode, 403)
  assert.equal((await invite(owner, contact.email)).json().code, 'already_member')
  assert.equal((await invite(owner, 'y@exemple.fr', 'member')).statusCode, 201)
  assert.deepEqual((await pending(owner)).json().filter((i) => i.email === 'y@exemple.fr').map((i) => i.role), ['member'])
  for (let i = 0; i < 9; i++) await invite(owner, `plafond${i}.${process.pid}@exemple.fr`)
  const over = await invite(owner, `plafond-de-trop.${process.pid}@exemple.fr`)
  assert.equal(over.statusCode, 409)
  assert.equal(over.json().code, 'too_many_invitations')
  for (const extra of [{ family_id: '00000000-0000-4000-8000-000000000000' }, { invited_by: owner.id }]) {
    assert.equal((await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: 'w@exemple.fr', role: 'member', ...extra } })).statusCode, 400)
  }
})

test('un membre de la famille A ne voit ni ne gère les invitations de B', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  await family(a, 'A'); await family(b, 'B')
  await invite(b, 'pour-b@exemple.fr')
  const idB = (await pending(b)).json()[0].id
  assert.deepEqual((await pending(a)).json(), [])
  assert.equal((await call(ctx.app, 'DELETE', `/api/families/me/invitations/${idB}`, { cookie: a.cookie })).statusCode, 404)
  assert.equal((await pending(b)).json().length, 1)
  assert.equal((await call(ctx.app, 'DELETE', `/api/families/me/invitations/${idB}`, { cookie: b.cookie })).statusCode, 200)
  assert.deepEqual((await pending(b)).json(), [])
  assert.equal((await call(ctx.app, 'DELETE', '/api/families/me/invitations/pas-un-uuid', { cookie: b.cookie })).statusCode, 404)
})

test('rôles : owner tout ; manager entre manager et member, jamais un owner ; contact rien', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const m1 = await join(owner, 'manager'), c1 = await join(owner, 'member'), c2 = await join(owner, 'member')
  assert.equal((await setRole(m1, c1.id, 'manager')).statusCode, 200)
  assert.equal((await setRole(m1, c1.id, 'member')).statusCode, 200)
  assert.equal((await setRole(m1, c1.id, 'owner')).statusCode, 403)
  assert.equal((await setRole(m1, owner.id, 'member')).statusCode, 403)
  assert.equal((await remove(m1, owner.id)).statusCode, 403)
  assert.equal((await setRole(c1, c2.id, 'manager')).statusCode, 403)
  assert.equal((await remove(c1, c2.id)).statusCode, 403)
  assert.equal((await setRole(owner, m1.id, 'owner')).statusCode, 200)
  assert.equal((await setRole(owner, c1.id, 'admin')).statusCode, 400)
  assert.equal((await setRole(owner, c1.id, 'member')).json().role, 'member')
  // Un membre d'une autre famille n'existe pas ici.
  const stranger = await newUser(ctx)
  await family(stranger, 'Ailleurs')
  assert.equal((await setRole(owner, stranger.id, 'member')).statusCode, 404)
  assert.equal((await remove(owner, stranger.id)).statusCode, 404)
  assert.equal((await members(stranger)).length, 1)
})

test('le dernier owner ne part pas et n’est pas rétrogradé ; un autre owner le permet', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const m = await join(owner, 'manager')
  assert.equal((await setRole(owner, owner.id, 'manager')).json().code, 'last_owner')
  assert.equal((await remove(owner, owner.id)).json().code, 'last_owner')
  await setRole(owner, m.id, 'owner')
  // Deux rétrogradations simultanées : au moins un owner reste.
  const both = await Promise.all([setRole(owner, owner.id, 'manager'), setRole(m, m.id, 'manager')])
  assert.deepEqual(both.map((r) => r.statusCode).sort(), [200, 409])
  const { rows: [{ n }] } = await ctx.db.query(
    "SELECT count(*)::int AS n FROM memberships WHERE role = 'owner' AND family_id = (SELECT family_id FROM memberships WHERE user_id = $1)", [owner.id])
  assert.equal(n, 1)
})

test('chacun peut partir ; un membre retiré perd l’accès aussitôt', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const c = await join(owner, 'member'), m = await join(owner, 'manager')
  assert.equal((await remove(c, c.id)).statusCode, 200)
  assert.equal((await call(ctx.app, 'GET', '/api/families/me', { cookie: c.cookie })).statusCode, 404)
  assert.equal((await remove(owner, m.id)).statusCode, 200)
  assert.equal((await call(ctx.app, 'GET', '/api/families/me/invitations', { cookie: m.cookie })).statusCode, 404)
  const { rows } = await ctx.db.query("SELECT action FROM audit_log WHERE target IN ($1, $2) AND action LIKE 'member_%' ORDER BY id", [c.id, m.id])
  assert.deepEqual(rows.map((r) => r.action), ['member_left', 'member_removed'])
})
