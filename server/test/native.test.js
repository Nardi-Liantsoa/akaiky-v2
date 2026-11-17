// Application native : jeton Bearer court + jeton de renouvellement tourné.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, native, newUser, NATIVE } from './helpers.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url) })
after(async () => { await ctx?.close(); dbh?.stop() })

const login = (u, origin = NATIVE) => native(ctx.app, 'POST', '/api/auth/native/login', {
  body: { email: u.email, password: u.password, device: 'Pixel 7 <script>' }, headers: { origin }
})
const refresh = (refreshToken) => native(ctx.app, 'POST', '/api/auth/native/refresh', { body: { refreshToken } })

test('connexion native : jetons Bearer, aucun cookie, CORS sans credentials', async () => {
  const u = await newUser(ctx)
  const r = await login(u)
  assert.equal(r.statusCode, 200, r.body)
  const { accessToken, refreshToken, expiresIn, user } = r.json()
  assert.match(accessToken, /^[A-Za-z0-9_-]{43}$/); assert.match(refreshToken, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(expiresIn, 900); assert.equal(user.email, u.email)
  assert.equal(r.headers['set-cookie'], undefined)
  assert.equal(r.headers['access-control-allow-origin'], NATIVE)
  assert.equal(r.headers['access-control-allow-credentials'], undefined)
  const me = await native(ctx.app, 'GET', '/api/auth/me', { token: accessToken })
  assert.equal(me.json().user.id, u.id)
  // Écriture en Bearer : pas d'en-tête anti-CSRF exigé, la ressource reste au propriétaire.
  const note = await native(ctx.app, 'POST', '/api/notes', { token: accessToken, body: { title: 'Depuis le téléphone' } })
  assert.equal(note.statusCode, 201, note.body)
  assert.equal((await call(ctx.app, 'GET', `/api/notes/${note.json().id}`, { cookie: u.cookie })).statusCode, 200)
})

test('pré-vol : origines natives exactes seulement', async () => {
  const ok = await ctx.app.inject({ method: 'OPTIONS', url: '/api/notes', headers: { origin: NATIVE, 'access-control-request-method': 'POST' } })
  assert.equal(ok.statusCode, 204)
  assert.equal(ok.headers['access-control-allow-origin'], NATIVE)
  assert.match(ok.headers['access-control-allow-headers'], /authorization/)
  const evil = await ctx.app.inject({ method: 'OPTIONS', url: '/api/notes', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } })
  assert.equal(evil.statusCode, 403)
  assert.equal(evil.headers['access-control-allow-origin'], undefined)
})

test('routes natives refusées depuis une autre origine', async () => {
  const u = await newUser(ctx)
  assert.equal((await login(u, 'https://evil.example')).statusCode, 403)
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/auth/native/login', payload: { email: u.email, password: u.password } })).statusCode, 403)
})

test('un transport ne remplace pas l’autre', async () => {
  const u = await newUser(ctx)
  const { accessToken } = (await login(u)).json()
  // Jeton d'accès présenté comme cookie : refusé.
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: `app-session=${accessToken}` })).json().user, null)
  // Jeton de session web présenté en Bearer : refusé.
  const webToken = u.cookie.match(/app-session=([A-Za-z0-9_-]{43})/)[1]
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: webToken })).json().user, null)
  // En-tête Bearer présent mais invalide : le cookie est ignoré.
  const both = await ctx.app.inject({ url: '/api/auth/me', headers: { authorization: 'Bearer invalide', cookie: u.cookie } })
  assert.equal(both.json().user, null)
  // « Basic » ajouté par un mandataire (préprod protégée) : session web intacte, CSRF toujours exigé.
  const basic = { authorization: 'Basic dXNlcjpwYXNz' }
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie, headers: basic })).json().user.id, u.id)
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/notes', payload: { title: 'x' }, headers: { ...basic, cookie: u.cookie, origin: 'https://evil.example' } })).statusCode, 403)
})

test('depuis l’app : inscription et mot de passe oublié sans en-tête web, cookie jamais lu', async () => {
  const email = `app${process.pid}@exemple.fr`
  const reg = await native(ctx.app, 'POST', '/api/auth/register', { body: { name: 'App', email, password: 'phrase de passe assez longue' } })
  assert.equal(reg.statusCode, 202, reg.body)
  assert.equal((await native(ctx.app, 'POST', '/api/auth/forgot-password', { body: { email } })).statusCode, 202)
  // Un cookie de session envoyé avec l'origine native est ignoré.
  const u = await newUser(ctx)
  const withCookie = await native(ctx.app, 'GET', '/api/auth/me', { headers: { cookie: u.cookie } })
  assert.equal(withCookie.json().user, null)
  assert.equal((await native(ctx.app, 'POST', '/api/notes', { body: { title: 'x' }, headers: { cookie: u.cookie } })).statusCode, 401)
})

test('renouvellement : rotation, ancien jeton d’accès invalidé', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  const next = await refresh(first.refreshToken)
  assert.equal(next.statusCode, 200, next.body)
  assert.notEqual(next.json().refreshToken, first.refreshToken)
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: first.accessToken })).json().user, null)
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: next.json().accessToken })).json().user.id, u.id)
})

test('réponse perdue : l’ancien jeton reste accepté tant que son successeur n’a pas servi', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  await refresh(first.refreshToken)                                  // réponse jamais reçue par l'app
  await ctx.db.query("UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id = $1", [u.id])
  const retry = await refresh(first.refreshToken)                   // l'app, rouverte plus tard, repasse l'ancien
  assert.equal(retry.statusCode, 200, retry.body)
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: retry.json().accessToken })).json().user.id, u.id)
  const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'refresh_replay' AND target = $1", [u.id])
  assert.equal(rows[0].n, 0, 'aucune fausse alerte')
})

test('vol : l’ancien jeton ne sert qu’une fois, la détection ne peut pas être effacée', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  const app = (await refresh(first.refreshToken)).json()
  assert.equal((await refresh(first.refreshToken)).statusCode, 200)   // le voleur, une fois
  assert.equal((await refresh(first.refreshToken)).statusCode, 401)   // pas deux
  assert.equal((await refresh(app.refreshToken)).statusCode, 401)     // l'app : rejeu détecté
  const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND kind = 'bearer'", [u.id])
  assert.equal(rows[0].n, 0, 'session fermée')
})

test('ancien jeton au-delà de 7 jours : refusé', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  await refresh(first.refreshToken)
  await ctx.db.query("UPDATE sessions SET rotated_at = now() - interval '8 days' WHERE user_id = $1", [u.id])
  assert.equal((await refresh(first.refreshToken)).statusCode, 401)
})

test('ancien jeton après que le successeur a servi : refusé, session intacte', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  const second = (await refresh(first.refreshToken)).json()
  const third = (await refresh(second.refreshToken)).json()
  assert.equal((await refresh(first.refreshToken)).statusCode, 401)
  assert.equal((await refresh(third.refreshToken)).statusCode, 200, 'la session de l’app continue')
})

test('vol de l’ancien jeton : le jeton écarté, présenté ensuite, ferme la session', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  const app = (await refresh(first.refreshToken)).json()           // rotation normale par l'app
  const thief = await refresh(first.refreshToken)                   // le voleur rejoue l'ancien jeton à temps
  assert.equal(thief.statusCode, 200)
  assert.equal((await refresh(app.refreshToken)).statusCode, 401)   // l'app renouvelle : rejeu détecté
  assert.equal((await refresh(thief.json().refreshToken)).statusCode, 401, 'le voleur perd la session')
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: thief.json().accessToken })).json().user, null)
  const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'refresh_replay' AND target = $1", [u.id])
  assert.equal(rows[0].n, 1)
})

test('renouvellements simultanés : chacun reçoit une paire, une seule survit', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  const results = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)])
  assert.deepEqual(results.map((r) => r.statusCode), [200, 200])
  const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND kind = 'bearer'", [u.id])
  assert.equal(rows[0].n, 1, 'une seule session pour l’appareil')
})

test('compte doté d’un second facteur : renouvellement refusé', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  await ctx.db.query("INSERT INTO mfa_factors(user_id, secret) VALUES ($1, 'x')", [u.id])
  assert.equal((await refresh(first.refreshToken)).statusCode, 401)
})

test('jeton d’accès expiré : 401, puis renouvellement possible', async () => {
  const u = await newUser(ctx)
  const first = (await login(u)).json()
  await ctx.db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND kind = 'bearer'", [u.id])
  assert.equal((await native(ctx.app, 'GET', '/api/notes', { token: first.accessToken })).statusCode, 401)
  assert.equal((await refresh(first.refreshToken)).statusCode, 200)
})

test('compte à double authentification : connexion native refusée', async () => {
  const admin = await newUser(ctx, { admin: true })
  const r = await login(admin)
  assert.equal(r.statusCode, 403)
  assert.equal(r.json().code, 'web_only')
  assert.equal(r.json().accessToken, undefined)
})

test('déconnexion, réinitialisation et révocation ferment les sessions natives', async () => {
  const u = await newUser(ctx)
  const a = (await login(u)).json()
  await native(ctx.app, 'POST', '/api/auth/logout', { token: a.accessToken })
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: a.accessToken })).json().user, null)
  assert.equal((await refresh(a.refreshToken)).statusCode, 401)

  // Jeton d'accès expiré : la déconnexion passe par le jeton de renouvellement.
  const d = (await login(u)).json()
  await ctx.db.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND kind = 'bearer'", [u.id])
  assert.equal((await native(ctx.app, 'POST', '/api/auth/native/logout', { body: { refreshToken: d.refreshToken } })).statusCode, 200)
  assert.equal((await refresh(d.refreshToken)).statusCode, 401)
  assert.equal((await native(ctx.app, 'POST', '/api/auth/native/logout', { body: { refreshToken: d.refreshToken } })).statusCode, 200, 'réponse identique')

  const b = (await login(u)).json()
  const list = (await call(ctx.app, 'GET', '/api/auth/app-sessions', { cookie: u.cookie })).json()
  assert.equal(list.length, 1); assert.equal(list[0].label, 'Pixel 7 script')
  const other = await newUser(ctx)
  assert.equal((await call(ctx.app, 'DELETE', `/api/auth/app-sessions/${list[0].id}`, { cookie: other.cookie })).statusCode, 404)
  assert.equal((await call(ctx.app, 'DELETE', `/api/auth/app-sessions/${'-'.repeat(36)}`, { cookie: u.cookie })).statusCode, 404)
  assert.equal((await call(ctx.app, 'DELETE', `/api/auth/app-sessions/${list[0].id}`, { cookie: u.cookie })).statusCode, 200)
  assert.equal((await refresh(b.refreshToken)).statusCode, 401)

  const c = (await login(u)).json()
  await call(ctx.app, 'POST', '/api/auth/forgot-password', { body: { email: u.email } })
  const token = ctx.sent.findLast((m) => m.to === u.email).text.match(/#reset=([A-Za-z0-9_-]+)/)[1]
  assert.equal((await call(ctx.app, 'POST', '/api/auth/reset-password', { body: { token, password: 'tout nouveau mot de passe' } })).statusCode, 200)
  assert.equal((await refresh(c.refreshToken)).statusCode, 401)
})

test('transport natif fermé quand NATIVE_ORIGINS est vide', async () => {
  const closed = await startApp(dbh.url, { NATIVE_ORIGINS: '' })
  try {
    const u = await newUser(closed)
    assert.equal((await native(closed.app, 'POST', '/api/auth/native/login', { body: { email: u.email, password: u.password } })).statusCode, 403)
  } finally { await closed.close() }
})
