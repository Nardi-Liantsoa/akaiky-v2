import { newToken } from '../src/security.js'
import { totp } from '../src/totp.js'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPool, migrate } from '../src/db.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import probeRoutes from './probe.js'

// Base PostgreSQL jetable dans Docker (ou TEST_DATABASE_URL si fournie, en CI).
export async function startDb() {
  if (process.env.TEST_DATABASE_URL) return { url: process.env.TEST_DATABASE_URL, stop() {} }
  const name = `app-test-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  // Données en RAM (--tmpfs) : l'image déclare un VOLUME, sans quoi chaque
  // lancement laisse un volume anonyme orphelin.
  execFileSync('docker', ['run', '-d', '--rm', '--tmpfs', '/var/lib/postgresql/data', '--name', name, '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=test',
    '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { stdio: 'ignore' })
  const port = execFileSync('docker', ['port', name, '5432/tcp']).toString().trim().split('\n')[0].split(':').pop()
  const url = `postgres://postgres:test@127.0.0.1:${port}/test`
  for (let i = 0; i < 60; i++) {
    const pool = createPool(url)
    try { await pool.query('SELECT 1'); await pool.end(); break } catch { await pool.end().catch(() => {}); await new Promise((r) => setTimeout(r, 500)) }
  }
  return { url, stop: () => execFileSync('docker', ['rm', '-fv', name], { stdio: 'ignore' }) }
}

export const ORIGIN = 'https://app.test'
export const PROBE = '/api/test-probe'
export const NATIVE = 'capacitor://localhost'

export async function startApp(url, env = {}, opts = {}) {
  const dist = mkdtempSync(join(tmpdir(), 'app-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>App</title>')
  writeFileSync(join(dist, 'assets', 'app-abc.js'), 'console.log(1)')
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: url, APP_ORIGIN: ORIGIN, STATIC_DIR: dist, APP_NAME: 'Mon app',
    NATIVE_ORIGINS: `${NATIVE},https://localhost`, RATE_LIMIT_IP: '10000', RATE_LIMIT_EMAIL: '10000',
    MFA_ENCRYPTION_KEY: 'ab'.repeat(32), ...env
  })
  const db = createPool(url)
  await migrate(db)
  const sent = []
  const mailer = { sent, async send(m) { sent.push(m) } }
  // SMS : faux fournisseur en mémoire, sauf si le test demande le vrai fournisseur « fake »
  // de la configuration (SMS_OUTBOX, SMS_PROVIDER) ; `logger` : un flux pour inspecter le journal.
  const texts = []
  const sms = env.SMS_OUTBOX || env.SMS_PROVIDER ? undefined : { available: true, sent: texts, async send(m) { texts.push(m) } }
  const app = await buildApp({ config, db, mailer, sms, logger: opts.logger ?? false })
  await app.register(probeRoutes, { prefix: PROBE })
  return { app, db, sent, texts: sms ? texts : app.sms.sent, close: async () => { await app.close(); await db.end(); rmSync(dist, { recursive: true, force: true }) } }
}

// Requête « navigateur légitime » : bonne origine + en-tête anti-CSRF.
export function call(app, method, url, { cookie, body, headers = {} } = {}) {
  return app.inject({
    method, url,
    headers: { origin: ORIGIN, 'x-app': '1', ...(cookie ? { cookie } : {}), ...headers },
    ...(body !== undefined ? { payload: body } : {})
  })
}

// Requête de l'application native : origine de la WebView, jeton Bearer.
export function native(app, method, url, { token, body, headers = {} } = {}) {
  return app.inject({
    method, url,
    headers: { origin: NATIVE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { payload: body } : {})
  })
}

export const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')
export const tokenIn = (mail, key) => mail.text.match(new RegExp(`#${key}=([A-Za-z0-9_-]+)`))[1]

let n = 0
export async function newUser(ctx, { admin = false } = {}) {
  const email = `user${++n}.${process.pid}@exemple.fr`
  const password = 'cheval batterie agrafe correcte'
  const r = await call(ctx.app, 'POST', '/api/auth/register', { body: { consent: true, name: `Utilisateur ${n}`, email, password } })
  if (r.statusCode !== 202) throw new Error(r.body)
  const mail = ctx.sent.findLast((m) => m.to === email)
  await call(ctx.app, 'POST', '/api/auth/confirm', { body: { token: tokenIn(mail, 'confirm') } })
  if (admin) await ctx.db.query('UPDATE users SET is_admin = true WHERE email = $1', [email])
  let login = await call(ctx.app, 'POST', '/api/auth/login', { body: { email, password } })
  if (admin) {
    const user = (await ctx.db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0]
    const invite = newToken()
    await ctx.db.query("INSERT INTO mfa_enrollment_invites(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [user.id, invite.hash])
    const setup = await call(ctx.app, 'POST', '/api/auth/mfa/setup', { cookie: cookieOf(login), body: { invitation: invite.token } })
    if (setup.statusCode !== 200) throw new Error(setup.body)
    login = await call(ctx.app, 'POST', '/api/auth/mfa/verify', { cookie: cookieOf(login), body: { code: totp(setup.json().secret) } })
  }
  if (login.statusCode !== 200 || !login.json().user) throw new Error(login.body)
  return { email, password, cookie: cookieOf(login), id: login.json().user.id }
}
