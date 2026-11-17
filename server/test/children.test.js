import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser, tokenIn } from './helpers.js'
import { loadConfig } from '../src/config.js'
import { MAX_CHILDREN } from '../src/routes/children.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000' }) })
after(async () => { await ctx.close(); dbh.stop() })

const family = async (u, name = 'Famille') => (await call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name } })).json()
const add = (u, firstName, extra = {}) => call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { firstName, ...extra } })
const list = (u) => call(ctx.app, 'GET', '/api/children', { cookie: u.cookie })
const patch = (u, id, body) => call(ctx.app, 'PATCH', `/api/children/${id}`, { cookie: u.cookie, body })
const del = (u, id) => call(ctx.app, 'DELETE', `/api/children/${id}`, { cookie: u.cookie })

// Membre ajouté par une vraie invitation (rôle donné).
async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}

test('l’owner ajoute deux enfants ; tous les membres les voient, dans l’ordre d’ajout', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await add(owner, '  Fy ')
  assert.equal(fy.statusCode, 201, fy.body)
  assert.deepEqual(Object.keys(fy.json()).sort(), ['avatarColor', 'createdAt', 'firstName', 'id'])
  assert.equal(fy.json().firstName, 'Fy')
  const tiana = (await add(owner, 'Tiana', { avatarColor: 'violet' })).json()
  assert.equal(tiana.avatarColor, 'violet')
  // Sans couleur choisie, les couleurs tournent : le 3e enfant n'a pas celle du 1er.
  assert.notEqual((await add(owner, 'Hery')).json().avatarColor, fy.json().avatarColor)
  const member = await join(owner, 'member')
  assert.deepEqual((await list(member)).json().map((c) => c.firstName), ['Fy', 'Tiana', 'Hery'])
})

test('le prénom n’apparaît jamais en clair en base, et chaque ligne a son propre chiffré', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const a = (await add(owner, 'Rivosoa')).json(), b = (await add(owner, 'Rivosoa')).json()
  const { rows } = await ctx.db.query('SELECT id, first_name_enc FROM children WHERE id = ANY($1)', [[a.id, b.id]])
  for (const r of rows) assert.ok(!r.first_name_enc.includes(Buffer.from('Rivosoa')))
  assert.notDeepEqual(rows[0].first_name_enc, rows[1].first_name_enc)
  // Chiffré recopié d'une ligne à l'autre : illisible (données associées liées à l'id).
  await ctx.db.query('UPDATE children SET first_name_enc = $1 WHERE id = $2', [rows.find((r) => r.id === a.id).first_name_enc, b.id])
  assert.equal((await list(owner)).statusCode, 500)
  await ctx.db.query('DELETE FROM children WHERE id = $1', [b.id])
  assert.equal((await list(owner)).statusCode, 200)
  const { rows: audit } = await ctx.db.query("SELECT details::text AS d FROM audit_log WHERE target = $1", [a.id])
  assert.ok(audit.every((r) => !String(r.d).includes('Rivosoa')), 'aucun prénom dans le journal d’audit')
})

test('renommer, changer la couleur, retirer : owner et manager oui, contact non (403)', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager'), member = await join(owner, 'member')
  const fy = (await add(manager, 'Fy')).json()
  assert.equal((await patch(manager, fy.id, { firstName: 'Fyfy', avatarColor: 'blue' })).json().firstName, 'Fyfy')
  assert.equal((await add(member, 'Intrus')).statusCode, 403)
  assert.equal((await patch(member, fy.id, { firstName: 'X' })).statusCode, 403)
  assert.equal((await del(member, fy.id)).statusCode, 403)
  assert.deepEqual((await list(member)).json().map((c) => [c.firstName, c.avatarColor]), [['Fyfy', 'blue']])
  assert.equal((await del(owner, fy.id)).statusCode, 200)
  assert.deepEqual((await list(owner)).json(), [])
})

test('A ne lit, ne modifie ni ne retire l’enfant de B (404)', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  await family(a, 'A'); await family(b, 'B')
  const childB = (await add(b, 'Enfant B')).json()
  assert.deepEqual((await list(a)).json(), [])
  assert.equal((await patch(a, childB.id, { firstName: 'Volé' })).statusCode, 404)
  assert.equal((await del(a, childB.id)).statusCode, 404)
  assert.equal((await patch(a, 'pas-un-uuid', { firstName: 'X' })).statusCode, 404)
  assert.deepEqual((await list(b)).json().map((c) => c.firstName), ['Enfant B'])
  // Sans famille : 404, sans session : 401.
  const lone = await newUser(ctx)
  assert.equal((await list(lone)).statusCode, 404)
  assert.equal((await call(ctx.app, 'GET', '/api/children')).statusCode, 401)
})

test('entrées : prénom vide ou trop long, couleur inconnue, champs imposés → 400', async () => {
  const owner = await newUser(ctx), other = await newUser(ctx)
  await family(owner); const fo = await family(other, 'Autre')
  for (const name of ['', '   ', 'x'.repeat(41)]) assert.equal((await add(owner, name)).statusCode, 400)
  assert.equal((await add(owner, 'Fy', { avatarColor: 'red' })).statusCode, 400)
  for (const extra of [{ family_id: fo.id }, { id: '6f1c2b1e-0000-4000-8000-000000000099' }, { first_name_enc: 'x' }]) {
    assert.equal((await add(owner, 'Fy', extra)).statusCode, 400)
  }
  const fy = (await add(owner, 'Fy')).json()
  assert.equal((await patch(owner, fy.id, {})).statusCode, 400)
  assert.equal((await patch(owner, fy.id, { family_id: fo.id })).statusCode, 400)
  assert.equal((await add(owner, '🌸'.repeat(40))).statusCode, 201)
})

test(`plafond de ${MAX_CHILDREN} enfants, tenu en ajouts simultanés`, async () => {
  const owner = await newUser(ctx)
  await family(owner)
  for (let i = 0; i < MAX_CHILDREN - 2; i++) await add(owner, `Enfant ${i}`)
  const results = await Promise.all([1, 2, 3, 4].map((i) => add(owner, `Course ${i}`)))
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 201, 409, 409])
  assert.equal((await list(owner)).json().length, MAX_CHILDREN)
})

test('famille supprimée : ses enfants aussi (cascade)', async () => {
  const owner = await newUser(ctx)
  const f = await family(owner)
  await add(owner, 'Fy')
  await ctx.db.query('DELETE FROM families WHERE id = $1', [f.id])
  const { rows: [{ n }] } = await ctx.db.query('SELECT count(*)::int AS n FROM children WHERE family_id = $1', [f.id])
  assert.equal(n, 0)
})

test('configuration : clé des données exigée en production, distincte de celle de la MFA', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_ORIGIN: 'https://a.example', TRUST_PROXY: '10.0.0.0/8', SMTP_HOST: 'smtp', MAIL_FROM: 'A <a@a.example>', MFA_ENCRYPTION_KEY: 'ab'.repeat(32) }
  assert.throws(() => loadConfig(base), /DATA_ENCRYPTION_KEY/)
  assert.throws(() => loadConfig({ ...base, DATA_ENCRYPTION_KEY: 'court' }), /DATA_ENCRYPTION_KEY/)
  assert.throws(() => loadConfig({ ...base, DATA_ENCRYPTION_KEY: 'AB'.repeat(32) }), /différer/)
  assert.equal(loadConfig({ ...base, DATA_ENCRYPTION_KEY: 'cd'.repeat(32) }).dataKey, 'cd'.repeat(32))
})

test('gestionnaire rétrogradé pendant un ajout : jamais d’ajout après la rétrogradation', async () => {
  for (let round = 0; round < 3; round++) {
    const owner = await newUser(ctx)
    await family(owner, `Course ${round}`)
    const manager = await join(owner, 'manager')
    const [added, demoted] = await Promise.all([
      add(manager, `Enfant ${round}`),
      call(ctx.app, 'PATCH', `/api/families/me/members/${manager.id}`, { cookie: owner.cookie, body: { role: 'member' } })
    ])
    assert.equal(demoted.statusCode, 200)
    assert.ok([201, 403].includes(added.statusCode), added.body)
    if (added.statusCode === 201) {
      const { rows } = await ctx.db.query(
        `SELECT action FROM audit_log WHERE (action = 'child_added' AND actor_id = $1) OR (action = 'member_role_changed' AND target = $1::text) ORDER BY id`, [manager.id])
      assert.deepEqual(rows.map((r) => r.action), ['child_added', 'member_role_changed'])
    }
  }
})
