import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDb, startApp, call, cookieOf, tokenIn, newUser, ORIGIN, PROBE } from './helpers.js'

let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url) })
after(async () => { await ctx?.close(); dbh?.stop() })

test('en-têtes de sécurité et CSP stricte sur le site et l’API', async () => {
  for (const url of ['/', '/api/auth/me', '/espace']) {
    const r = await ctx.app.inject({ url })
    assert.match(r.headers['content-security-policy'], /default-src 'self'.*script-src 'self'.*frame-ancestors 'none'/)
    assert.equal(r.headers['x-content-type-options'], 'nosniff')
    assert.equal(r.headers['x-frame-options'], 'DENY')
  }
  assert.equal((await ctx.app.inject({ url: '/api/auth/me' })).headers['cache-control'], 'no-store')
})

test('site statique : SPA, assets immuables, aucun accès au disque par le chemin', async () => {
  assert.equal((await ctx.app.inject({ url: '/espace' })).statusCode, 200)
  assert.match((await ctx.app.inject({ url: '/assets/app-abc.js' })).headers['cache-control'], /immutable/)
  for (const url of ['/../package.json', '/%2e%2e/package.json', '/assets/../../etc/passwd', '/.env', '/assets/inconnu.js']) {
    const r = await ctx.app.inject({ url })
    assert.ok(r.statusCode === 404 || !/"name"|root:/.test(r.body), url)
  }
})

test('/health ne dépend pas de la base, /ready la vérifie', async () => {
  assert.equal((await ctx.app.inject({ url: '/health' })).statusCode, 200)
  assert.equal((await ctx.app.inject({ url: '/ready' })).statusCode, 200)
})

test('CSRF : écriture refusée sans la bonne origine ou sans l’en-tête', async () => {
  const body = { email: 'x@exemple.fr', password: 'nimporte quoi long' }
  const noOrigin = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: body, headers: { 'x-app': '1' } })
  const evil = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: body, headers: { origin: 'https://evil.example', 'x-app': '1' } })
  const noHeader = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: body, headers: { origin: ORIGIN } })
  for (const r of [noOrigin, evil, noHeader]) assert.equal(r.statusCode, 403)
})

test('fermé par défaut : une route sans session répond 401, une route admin 403 à un utilisateur', async () => {
  assert.equal((await call(ctx.app, 'GET', PROBE)).statusCode, 401)
  assert.equal((await call(ctx.app, 'GET', '/api/auth/security')).statusCode, 401)
  assert.equal((await call(ctx.app, 'GET', '/api/admin/users')).statusCode, 401)
  const u = await newUser(ctx)
  for (const url of ['/api/admin/users', '/api/admin/audit']) {
    assert.equal((await call(ctx.app, 'GET', url, { cookie: u.cookie })).statusCode, 403, url)
  }
  assert.equal((await call(ctx.app, 'GET', '/api/inconnue', { cookie: u.cookie })).statusCode, 404)
})

test('administration : liste des comptes et journal pour un admin avec MFA', async () => {
  const admin = await newUser(ctx, { admin: true })
  const users = (await call(ctx.app, 'GET', '/api/admin/users', { cookie: admin.cookie })).json()
  const mine = users.find((u) => u.email === admin.email)
  assert.equal(mine.mfa, true)
  assert.equal(mine.password_hash, undefined, 'jamais de hachage dans une réponse')
  const logs = (await call(ctx.app, 'GET', '/api/admin/audit', { cookie: admin.cookie })).json()
  assert.ok(logs.some((l) => l.action === 'mfa_enabled'))
})

test('inscription : mot de passe faible refusé, aucune énumération des comptes', async () => {
  const weak = await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: 'A', email: 'faible@exemple.fr', password: 'court' } })
  assert.equal(weak.statusCode, 400)
  const u = await newUser(ctx)
  const again = await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: 'Autre', email: u.email, password: 'un autre mot de passe long' } })
  assert.equal(again.statusCode, 202)
  assert.match(ctx.sent.at(-1).subject, /déjà un compte/)
  const fresh = await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: 'N', email: `neuf${process.pid}@exemple.fr`, password: 'un mot de passe très long' } })
  assert.equal(JSON.stringify(again.json()), JSON.stringify(fresh.json()), 'réponse identique')
})

test('connexion : confirmation exigée, cookie HttpOnly SameSite=Strict, erreurs identiques', async () => {
  const email = `attente${process.pid}@exemple.fr`, password = 'mot de passe pas encore confirmé'
  await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: 'Attente', email, password } })
  assert.equal((await call(ctx.app, 'POST', '/api/auth/login', { body: { email, password } })).statusCode, 403)
  await call(ctx.app, 'POST', '/api/auth/confirm', { body: { token: tokenIn(ctx.sent.findLast((m) => m.to === email), 'confirm') } })
  const ok = await call(ctx.app, 'POST', '/api/auth/login', { body: { email, password } })
  assert.equal(ok.statusCode, 200)
  const c = String(ok.headers['set-cookie'])
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/)
  const me = await call(ctx.app, 'GET', '/api/auth/me', { cookie: cookieOf(ok) })
  assert.equal(me.json().user.email, email)
  const wrong = await call(ctx.app, 'POST', '/api/auth/login', { body: { email, password: 'mauvais mot de passe' } })
  const unknown = await call(ctx.app, 'POST', '/api/auth/login', { body: { email: `inconnu${process.pid}@exemple.fr`, password: 'mauvais mot de passe' } })
  assert.equal(wrong.statusCode, 401); assert.equal(wrong.body, unknown.body)
})

test('connexion légitime possible après 5 échecs distants', async () => {
  const u = await newUser(ctx)
  for (let i = 0; i < 5; i++) await call(ctx.app, 'POST', '/api/auth/login', { body: { email: u.email, password: 'mauvais mot de passe' } })
  const r = await call(ctx.app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
  assert.equal(r.statusCode, 200)
})

test('réinitialisation : sessions fermées, lien à usage unique', async () => {
  const u = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/auth/forgot-password', { body: { email: u.email } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === u.email && /Réinitialisation/.test(m.subject)), 'reset')
  assert.equal((await call(ctx.app, 'POST', '/api/auth/reset-password', { body: { token, password: 'court' } })).statusCode, 400)
  const ok = await call(ctx.app, 'POST', '/api/auth/reset-password', { body: { token, password: 'nouveau mot de passe très long' } })
  assert.equal(ok.statusCode, 200)
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user, null, 'ancienne session fermée')
  assert.equal((await call(ctx.app, 'POST', '/api/auth/reset-password', { body: { token, password: 'encore un autre mot de passe' } })).statusCode, 400)
  assert.equal((await call(ctx.app, 'POST', '/api/auth/login', { body: { email: u.email, password: 'nouveau mot de passe très long' } })).statusCode, 200)
  const unknown = await call(ctx.app, 'POST', '/api/auth/forgot-password', { body: { email: `absent${process.pid}@exemple.fr` } })
  assert.equal(unknown.statusCode, 202)
})

test('déconnexion : la session est détruite côté serveur', async () => {
  const u = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/auth/logout', { cookie: u.cookie })
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user, null)
})

test('limitation par IP puis par adresse (brute force, arrosage de mails)', async () => {
  const strict = await startApp(dbh.url, { RATE_LIMIT_IP: '3', RATE_LIMIT_EMAIL: '2' })
  try {
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await call(strict.app, 'POST', '/api/auth/login', { body: { email: `ip${i}@exemple.fr`, password: 'mauvais mot de passe' } })).statusCode)
    assert.deepEqual(codes, [401, 401, 401, 429])
    const other = await startApp(dbh.url, { RATE_LIMIT_IP: '100', RATE_LIMIT_EMAIL: '2' })
    try {
      const mails = []
      for (let i = 0; i < 3; i++) mails.push((await call(other.app, 'POST', '/api/auth/forgot-password', { body: { email: 'cible@exemple.fr' } })).statusCode)
      assert.deepEqual(mails, [202, 202, 429])
    } finally { await other.close() }
  } finally { await strict.close() }
})

test('origines localhost : acceptées en développement, refusées en production', async () => {
  const body = { email: 'x@exemple.fr', password: 'nimporte quoi long' }
  const dev = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: body, headers: { origin: 'http://localhost:4001', 'x-app': '1' } })
  assert.notEqual(dev.statusCode, 403, 'développement : localhost accepté')
  const { buildApp } = await import('../src/app.js')
  const { loadConfig } = await import('../src/config.js')
  const prodConfig = loadConfig({ NODE_ENV: 'production', PUSH_PROVIDER: 'none', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), DATA_ENCRYPTION_KEY: 'cd'.repeat(32), DATABASE_URL: dbh.url, APP_ORIGIN: 'https://app.test', STATIC_DIR: '/nonexistent', TRUST_PROXY: '10.0.0.0/8' })
  const prod = await buildApp({ config: prodConfig, db: ctx.db, mailer: { async send() {} }, logger: false })
  try {
    const r = await prod.inject({ method: 'POST', url: '/api/auth/login', payload: body, headers: { origin: 'http://localhost:4001', 'x-app': '1' } })
    assert.equal(r.statusCode, 403, 'production : localhost refusé')
  } finally { await prod.close() }
})

test('configuration de production : valeurs dangereuses refusées au démarrage', async () => {
  const { loadConfig } = await import('../src/config.js')
  const base = { NODE_ENV: 'production', PUSH_PROVIDER: 'none', DATABASE_URL: 'postgres://x', APP_ORIGIN: 'https://app.test', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), DATA_ENCRYPTION_KEY: 'cd'.repeat(32), TRUST_PROXY: '10.0.0.0/8' }
  assert.throws(() => loadConfig({ ...base, TRUST_PROXY: undefined }), /TRUST_PROXY requis/)
  assert.throws(() => loadConfig({ ...base, APP_ORIGIN: 'http://app.test' }), /https/)
  assert.throws(() => loadConfig({ ...base, MFA_ENCRYPTION_KEY: undefined }), /MFA_ENCRYPTION_KEY/)
  assert.throws(() => loadConfig({ ...base, TRUST_PROXY: 'true' }), /TRUST_PROXY/)
  assert.throws(() => loadConfig({ ...base, NATIVE_ORIGINS: '*' }), /NATIVE_ORIGINS/)
  assert.throws(() => loadConfig({ ...base, NATIVE_ACCESS_MINUTES: '15m' }), /invalide/)
  assert.throws(() => loadConfig({ ...base, SESSION_IDLE_DAYS: '' }), /invalide/)
  assert.throws(() => loadConfig({ ...base, SMTP_HOST: 'smtp.exemple.fr' }), /MAIL_FROM/)
  const { createMailer } = await import('../src/mailer.js')
  assert.throws(() => createMailer(loadConfig(base), { info() {} }), /SMTP_HOST/)
})
