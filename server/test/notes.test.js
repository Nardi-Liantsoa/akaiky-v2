// La forme de test à reproduire pour chaque ressource métier du projet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser } from './helpers.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { NOTES_PER_USER: '3' }) })
after(async () => { await ctx?.close(); dbh?.stop() })

const create = (u, body = { title: 'Ma note', body: 'Privée' }) => call(ctx.app, 'POST', '/api/notes', { cookie: u.cookie, body })

test('A ne touche pas la note de B : lecture, modification, suppression → 404, liste vide', async () => {
  const alice = await newUser(ctx), bob = await newUser(ctx)
  const note = (await create(alice)).json()
  assert.equal((await call(ctx.app, 'GET', `/api/notes/${note.id}`, { cookie: bob.cookie })).statusCode, 404)
  assert.equal((await call(ctx.app, 'PUT', `/api/notes/${note.id}`, { cookie: bob.cookie, body: { title: 'Piratée' } })).statusCode, 404)
  assert.equal((await call(ctx.app, 'DELETE', `/api/notes/${note.id}`, { cookie: bob.cookie })).statusCode, 404)
  assert.deepEqual((await call(ctx.app, 'GET', '/api/notes', { cookie: bob.cookie })).json(), [])
  // Même réponse qu'une note inexistante : on ne confirme pas son existence.
  const missing = await call(ctx.app, 'GET', '/api/notes/00000000-0000-4000-8000-000000000000', { cookie: bob.cookie })
  assert.equal(missing.body, (await call(ctx.app, 'GET', `/api/notes/${note.id}`, { cookie: bob.cookie })).body)
  const mine = (await call(ctx.app, 'GET', `/api/notes/${note.id}`, { cookie: alice.cookie })).json()
  assert.deepEqual([mine.title, mine.body], ['Ma note', 'Privée'])
})

test('le propriétaire vient de la session : owner_id ou champ inconnu dans le corps → 400', async () => {
  const alice = await newUser(ctx), bob = await newUser(ctx)
  assert.equal((await create(alice, { title: 'x', owner_id: bob.id })).statusCode, 400)
  assert.equal((await create(alice, { title: 'x', is_admin: true })).statusCode, 400)
  const note = (await create(alice)).json()
  assert.equal((await call(ctx.app, 'PUT', `/api/notes/${note.id}`, { cookie: alice.cookie, body: { title: 'x', owner_id: bob.id } })).statusCode, 400)
  assert.equal(Object.hasOwn(note, 'owner_id'), false, 'réponse construite champ par champ')
})

test('entrées validées : titre vide, trop long, type inattendu, identifiant malformé', async () => {
  const u = await newUser(ctx)
  for (const body of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { title: 42 }, { title: 'x', body: ['liste'] }, []]) {
    assert.equal((await create(u, body)).statusCode, 400, JSON.stringify(body))
  }
  assert.equal((await call(ctx.app, 'GET', '/api/notes/pas-un-uuid', { cookie: u.cookie })).statusCode, 404)
})

test('quota par compte tenu même avec des créations simultanées', async () => {
  const u = await newUser(ctx)
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(u, { title: `n${i}` })))
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 201, 201, 409, 409, 409])
})

test('suppression consignée dans le journal d’audit', async () => {
  const u = await newUser(ctx)
  const note = (await create(u)).json()
  assert.equal((await call(ctx.app, 'DELETE', `/api/notes/${note.id}`, { cookie: u.cookie })).statusCode, 200)
  const { rows } = await ctx.db.query("SELECT actor_id FROM audit_log WHERE action = 'note_deleted' AND target = $1", [note.id])
  assert.equal(rows[0].actor_id, u.id)
})
