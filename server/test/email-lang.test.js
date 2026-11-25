import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, newUser, tokenIn } from './helpers.js'

// Courriels dans la langue du destinataire (NAR-211) : users.lang, posée à l'inscription
// puis par PUT /api/auth/me/lang ; malgache par défaut.
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000' }) })
after(async () => { await ctx.close(); dbh.stop() })

const langOf = async (email) => (await ctx.db.query('SELECT lang FROM users WHERE email = $1', [email])).rows[0].lang
const lastTo = (email) => ctx.sent.findLast((m) => m.to === email)
const setLang = (u, body) => call(ctx.app, 'PUT', '/api/auth/me/lang', { cookie: u?.cookie, body })
let n = 0
const address = () => `lang${++n}.${process.pid}@exemple.fr`

test('inscription : langue gardée, confirmation dans cette langue ; sans langue ou inconnue, malgache', async () => {
  for (const [lang, expected, subject] of [['en', 'en', /^Confirm your address/], ['mg', 'mg', /^Hamarino/], [undefined, 'mg', /^Hamarino/], ['de', 'mg', /^Hamarino/]]) {
    const email = address()
    const r = await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: 'N', email, password: 'une phrase de passe longue', lang } })
    assert.equal(r.statusCode, 202)
    assert.equal(await langOf(email), expected)
    assert.match(lastTo(email).subject, subject)
  }
})

test('adresse déjà prise : l’avis part dans la langue du titulaire, pas du demandeur', async () => {
  const u = await newUser(ctx, { lang: 'en' })
  await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: 'X', email: u.email, password: 'un autre mot de passe long', lang: 'fr' } })
  assert.match(lastTo(u.email).subject, /^You already have an account/)
  assert.equal(await langOf(u.email), 'en')
})

test('PUT /me/lang : change la langue du compte de la session, puis mot de passe oublié et modifié dans cette langue', async () => {
  const u = await newUser(ctx, { lang: 'fr' })
  const r = await setLang(u, { lang: 'mg' })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(r.json(), { lang: 'mg' })
  assert.equal(await langOf(u.email), 'mg')
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user.lang, 'mg')

  await call(ctx.app, 'POST', '/api/auth/forgot-password', { body: { email: u.email } })
  await new Promise((res) => setTimeout(res, 200))
  const reset = lastTo(u.email)
  assert.match(reset.subject, /^Fanovana ny teny miafinao/)
  await call(ctx.app, 'POST', '/api/auth/reset-password', { body: { token: tokenIn(reset, 'reset'), password: 'nouvelle phrase de passe longue' } })
  assert.match(lastTo(u.email).subject, /^Niova ny teny miafinao/)
})

test('PUT /me/lang : sans session 401, langue inconnue ou champ en plus 400, et jamais le compte d’un autre', async () => {
  assert.equal((await setLang(null, { lang: 'fr' })).statusCode, 401)
  const a = await newUser(ctx, { lang: 'fr' }), b = await newUser(ctx, { lang: 'fr' })
  assert.equal((await setLang(a, { lang: 'de' })).statusCode, 400)
  assert.equal((await setLang(a, {})).statusCode, 400)
  // Aucun moyen de nommer un autre compte : un champ en plus est refusé.
  const bId = (await ctx.db.query('SELECT id FROM users WHERE email = $1', [b.email])).rows[0].id
  assert.equal((await setLang(a, { lang: 'en', userId: bId })).statusCode, 400)
  assert.equal((await setLang(a, { lang: 'en' })).statusCode, 200)
  assert.equal(await langOf(a.email), 'en')
  assert.equal(await langOf(b.email), 'fr')
})

test('invitation dans la langue de l’invitant ; avis de suppression de la famille dans la langue de chaque membre', async () => {
  const owner = await newUser(ctx, { lang: 'en' }), member = await newUser(ctx, { lang: 'mg' })
  await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille Rabe' } })
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: member.email, role: 'member' } })
  const invitation = lastTo(member.email)
  assert.match(invitation.subject, /^Invitation to join a family/)
  assert.equal((await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: member.cookie, body: { token: tokenIn(invitation, 'invite') } })).statusCode, 200)

  const del = await call(ctx.app, 'DELETE', '/api/families/me', { cookie: owner.cookie, body: { password: owner.password } })
  assert.equal(del.statusCode, 200)
  await new Promise((res) => setTimeout(res, 100))
  assert.match(lastTo(member.email).subject, /^Voafafa ny fianakaviana/)
})
