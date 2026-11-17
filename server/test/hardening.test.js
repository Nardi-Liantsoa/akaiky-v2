import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { startDb, startApp, call, native, newUser } from './helpers.js'
import { createLimiter, hashPassword, rateLimitKey } from '../src/security.js'
import { createPool, verifySchema } from '../src/db.js'
import { loadConfig } from '../src/config.js'
import { buildApp } from '../src/app.js'

test('limiteur : saturation sans blocage global ni éviction des compteurs', () => {
  const limit = createLimiter({ max: 2, windowMs: 60000, maxKeys: 2 })
  assert.equal(limit('a'), true); assert.equal(limit('b'), true)
  assert.equal(limit('c'), true); assert.equal(limit('a'), true); assert.equal(limit('a'), false)
})
test('hachages : file bornée, surcharge refusée puis service disponible', async () => {
  const results = await Promise.allSettled(Array.from({ length: 14 }, () => hashPassword('un long mot de passe test')))
  assert.ok(results.some(r => r.status === 'rejected' && r.reason.status === 503))
  assert.ok(results.some(r => r.status === 'fulfilled'))
  assert.match(await hashPassword('un nouveau mot de passe test'), /^scrypt\$/)
})
test('configuration : aucun proxy implicitement fiable', () => {
  const env = { DATABASE_URL: 'postgres://unused' }
  assert.equal(loadConfig(env).trustProxy, false)
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY: 'true' }))
  assert.throws(() => loadConfig({ ...env, TRUST_PROXY: '1' }))
})
test('API : entrées malformées, proxy falsifié et quotas globaux', async () => {
  const db = await startDb(), ctx = await startApp(db.url, { TRUST_PROXY: '10.42.0.2' })
  ctx.app.get('/test-ip', req => ({ ip: req.ip }))
  try {
    const badCookie = await call(ctx.app, 'GET', '/api/auth/me', { cookie: 'app-session=%ZZ' })
    assert.equal(badCookie.statusCode, 200); assert.equal(badCookie.json().user, null)
    assert.equal((await ctx.app.inject({ url: '/%ZZ' })).statusCode, 400)
    const spoofed = await ctx.app.inject({ url: '/test-ip', remoteAddress: '10.42.0.3', headers: { 'x-forwarded-for': '1.2.3.4' } })
    assert.equal(spoofed.json().ip, '10.42.0.3')
    const trusted = await ctx.app.inject({ url: '/test-ip', remoteAddress: '10.42.0.2', headers: { 'x-forwarded-for': '1.2.3.4' } })
    assert.equal(trusted.json().ip, '1.2.3.4')
    for (let i = 0; i < 300; i++) await ctx.app.inject({ url: '/api/auth/me', remoteAddress: '10.1.1.1' })
    const limited = await ctx.app.inject({ url: '/api/auth/me', remoteAddress: '10.1.1.1' })
    assert.equal(limited.statusCode, 429); assert.equal(limited.headers['retry-after'], '60')
    assert.equal((await ctx.app.inject({ url: '/health', remoteAddress: '10.1.1.1' })).statusCode, 200)
  } finally { await ctx.close(); db.stop() }
})
test('PostgreSQL : parcours restreint, élévation et DDL refusés', async () => {
  const db = await startDb(), admin = await startApp(db.url)
  let runtime
  try {
    const sql = (await readFile(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8')).replace(":'runtime_password'", "'runtime-test-only'")
    await admin.db.query(sql)
    const url = new URL(db.url); url.username = 'app_runtime'; url.password = 'runtime-test-only'
    const pool = createPool(url.toString())
    await verifySchema(pool)
    const config = loadConfig({ DATABASE_URL: url.toString(), APP_ORIGIN: 'https://app.test', RATE_LIMIT_IP: '10000', NATIVE_ORIGINS: 'capacitor://localhost' })
    const sent = [], app = await buildApp({ config, db: pool, mailer: { async send(m) { sent.push(m) } }, logger: false })
    runtime = { app, db: pool, sent }
    const user = await newUser(runtime)
    assert.equal((await call(app, 'GET', '/api/auth/me', { cookie: user.cookie })).json().user.id, user.id)
    const nat = await native(app, 'POST', '/api/auth/native/login', { body: { email: user.email, password: user.password } })
    assert.equal(nat.statusCode, 200, nat.body)
    const renewed = await native(app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: nat.json().refreshToken } })
    assert.equal(renewed.statusCode, 200, renewed.body)
    await native(app, 'POST', '/api/auth/native/logout', { body: { refreshToken: renewed.json().refreshToken } })
    assert.equal((await native(app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: renewed.json().refreshToken } })).statusCode, 401)
    await assert.rejects(pool.query('UPDATE users SET is_admin = true'), /permission denied/)
    await assert.rejects(pool.query('CREATE TABLE public.forbidden(id int)'), /permission denied/)
    await assert.rejects(pool.query("COPY (SELECT 1) TO PROGRAM 'true'"), /permission denied|superuser/)
    await assert.rejects(pool.query('DELETE FROM audit_log'), /permission denied/)
    await assert.rejects(pool.query("UPDATE users SET email = 'pirate@exemple.fr'"), /permission denied/)
    await assert.rejects(pool.query("UPDATE audit_log SET action = 'x'"), /permission denied/)
    await assert.rejects(pool.query("INSERT INTO mfa_enrollment_invites(user_id, token_hash, expires_at) SELECT id, '\\x00', now() FROM users"), /permission denied/)
    await assert.rejects(pool.query('SET ROLE postgres'), /permission denied/)
  } finally {
    if (runtime) { await runtime.app.close(); await runtime.db.end() }
    await admin.close(); db.stop()
  }
})

test('IPv6 : changer le suffixe ne contourne pas le quota du préfixe', () => {
  assert.equal(rateLimitKey('2001:db8:1234:5678::1'), rateLimitKey('2001:0db8:1234:5678:abcd:ffff:1:2'))
  assert.notEqual(rateLimitKey('2001:db8:1234:5678::1'), rateLimitKey('2001:db8:1234:5679::1'))
  assert.equal(rateLimitKey('::ffff:127.0.0.1'), '127.0.0.1')
})
test('délai de connexion : croissance après dix échecs, plafond de 30 secondes', async () => {
  const { loginDelay } = await import('../src/login-guard.js')
  assert.deepEqual([0, 9, 10, 11, 12, 13, 14, 15, 1000000].map(loginDelay), [0, 0, 1, 2, 4, 8, 16, 30, 30])
})
