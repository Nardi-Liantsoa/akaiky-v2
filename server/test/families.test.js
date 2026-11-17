import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser } from './helpers.js'
import { requireFamilyRole } from '../src/families.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url) })
after(async () => { await ctx.close(); dbh.stop() })

const create = (u, name = 'Famille Rabe') => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name } })
const mine = (u) => call(ctx.app, 'GET', '/api/families/me', { cookie: u.cookie })
const rename = (u, name) => call(ctx.app, 'PATCH', '/api/families/me', { cookie: u.cookie, body: { name } })
// Ajout direct en base : les invitations arrivent avec NAR-134.
const join = (familyId, u, role) => ctx.db.query('INSERT INTO memberships(family_id, user_id, role) VALUES ($1, $2, $3)', [familyId, u.id, role])

test('le parent crée sa famille et en devient owner', async () => {
  const u = await newUser(ctx)
  assert.equal((await mine(u)).statusCode, 404)
  assert.equal((await mine(u)).json().code, 'no_family')
  const r = await create(u, '  Famille Rakoto  ')
  assert.equal(r.statusCode, 201, r.body)
  assert.deepEqual(Object.keys(r.json()).sort(), ['id', 'name', 'role'])
  assert.equal(r.json().name, 'Famille Rakoto')
  assert.equal(r.json().role, 'owner')
  const me = (await mine(u)).json()
  assert.equal(me.id, r.json().id)
  assert.deepEqual(me.members, [{ userId: u.id, name: me.members[0].name, role: 'owner', isMe: true }])
  const { rows } = await ctx.db.query("SELECT action FROM audit_log WHERE target = $1", [r.json().id])
  assert.deepEqual(rows.map((x) => x.action), ['family_created'])
})

test('une seule famille par compte, y compris en créations simultanées', async () => {
  const u = await newUser(ctx)
  const results = await Promise.all([create(u, 'Une'), create(u, 'Deux'), create(u, 'Trois')])
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409, 409])
  assert.equal(results.find((r) => r.statusCode === 409).json().code, 'family_exists')
  assert.equal((await create(u, 'Encore')).statusCode, 409)
  const { rows: [{ n }] } = await ctx.db.query('SELECT count(*)::int AS n FROM memberships WHERE user_id = $1', [u.id])
  assert.equal(n, 1)
  // La famille orpheline d'une création refusée n'existe pas.
  const { rows: [{ orphans }] } = await ctx.db.query('SELECT count(*)::int AS orphans FROM families f WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.family_id = f.id)')
  assert.equal(orphans, 0)
})

test('A ne lit ni ne modifie la famille de B', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  const fa = (await create(a, 'Famille A')).json(), fb = (await create(b, 'Famille B')).json()
  assert.equal((await mine(a)).json().id, fa.id)
  assert.equal((await rename(a, 'Piratée')).json().id, fa.id)
  assert.equal((await mine(b)).json().name, 'Famille B')
  // La garde, que les tables métier utiliseront avec la famille lue sur leur ligne.
  await assert.rejects(requireFamilyRole(ctx.db, { user: { id: a.id } }, fb.id, ['owner', 'manager', 'member']), { status: 404 })
  await assert.rejects(requireFamilyRole(ctx.db, { user: { id: a.id } }, 'pas-un-uuid', ['owner']), { status: 404 })
  assert.equal(await requireFamilyRole(ctx.db, { user: { id: a.id } }, fa.id, ['owner']), 'owner')
  // Sans famille : 404 sur lecture comme sur modification.
  const c = await newUser(ctx)
  assert.equal((await mine(c)).statusCode, 404)
  assert.equal((await rename(c, 'X')).statusCode, 404)
})

test('renommer : owner et manager oui, member non', async () => {
  const owner = await newUser(ctx), manager = await newUser(ctx), member = await newUser(ctx)
  const f = (await create(owner)).json()
  await join(f.id, manager, 'manager'); await join(f.id, member, 'member')
  assert.equal((await rename(manager, 'Par le gestionnaire')).statusCode, 200)
  const denied = await rename(member, 'Par le contact')
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().code, 'family_role')
  assert.equal((await mine(member)).json().name, 'Par le gestionnaire')
  assert.equal((await rename(owner, 'Par le parent')).json().name, 'Par le parent')
  assert.deepEqual((await mine(member)).json().members.map((m) => m.role), ['owner', 'manager', 'member'])
})

test('rôle, famille ou admin envoyés dans un corps : 400, jamais appliqués', async () => {
  const u = await newUser(ctx), other = await newUser(ctx)
  const fo = (await create(other)).json()
  for (const extra of [{ role: 'owner' }, { family_id: fo.id }, { is_admin: true }, { id: fo.id }]) {
    assert.equal((await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'X', ...extra } })).statusCode, 400)
  }
  assert.equal((await mine(u)).statusCode, 404)
  const f = (await create(u)).json()
  await join(f.id, other, 'member').catch(() => {}) // other a déjà sa famille : refusé par l'unicité
  for (const extra of [{ role: 'member' }, { family_id: fo.id }, { is_admin: true }]) {
    assert.equal((await call(ctx.app, 'PATCH', '/api/families/me', { cookie: u.cookie, body: { name: 'Y', ...extra } })).statusCode, 400)
  }
  assert.equal((await mine(u)).json().role, 'owner')
  assert.equal((await mine(other)).json().id, fo.id)
  const { rows: [{ is_admin }] } = await ctx.db.query('SELECT is_admin FROM users WHERE id = $1', [u.id])
  assert.equal(is_admin, false)
})

test('nom vide, trop long ou absent : 400', async () => {
  const u = await newUser(ctx)
  for (const name of ['', '   ', 'x'.repeat(81)]) assert.equal((await create(u, name)).statusCode, 400)
  assert.equal((await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: {} })).statusCode, 400)
  assert.equal((await call(ctx.app, 'POST', '/api/families', { body: { name: 'Sans session' } })).statusCode, 401)
})

test('membre retiré : plus d’accès à la requête suivante', async () => {
  const owner = await newUser(ctx), manager = await newUser(ctx)
  const f = (await create(owner)).json()
  await join(f.id, manager, 'manager')
  assert.equal((await rename(manager, 'Avant')).statusCode, 200)
  await ctx.db.query('DELETE FROM memberships WHERE user_id = $1', [manager.id])
  assert.equal((await mine(manager)).statusCode, 404)
  assert.equal((await rename(manager, 'Après')).statusCode, 404)
  assert.equal((await mine(owner)).json().name, 'Avant')
})

test('suppression d’une famille : adhésions effacées en cascade', async () => {
  const owner = await newUser(ctx), member = await newUser(ctx)
  const f = (await create(owner)).json()
  await join(f.id, member, 'member')
  await ctx.db.query('DELETE FROM families WHERE id = $1', [f.id])
  const { rows: [{ n }] } = await ctx.db.query('SELECT count(*)::int AS n FROM memberships WHERE family_id = $1', [f.id])
  assert.equal(n, 0)
})
