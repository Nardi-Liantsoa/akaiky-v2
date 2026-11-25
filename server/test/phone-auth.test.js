// Inscription et connexion par numéro de téléphone (NAR-136) : parcours, énumération
// (réponse et durée), essais, limites d'envoi (numéro, IP, total), rejeu, concurrence,
// journal sans code, configuration de production, droits SQL du rôle applicatif.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { startDb, startApp, call, native, cookieOf, newUser } from './helpers.js'
import { loadConfig } from '../src/config.js'
import { createSms, smsTexts } from '../src/sms.js'
import { createPool, verifySchema } from '../src/db.js'
import { buildApp } from '../src/app.js'

const PASSWORD = 'tsara ny andro anio maraina'
// Limites larges pour le parcours et l'énumération ; chaque test de limite a son app.
const OPEN = { SMS_PER_IP_PER_HOUR: '10000', SMS_PER_NUMBER_PER_HOUR: '1000', SMS_RESEND_SECONDS: '1', SMS_PER_HOUR: '100000', REGISTRATIONS_PER_HOUR: '100000' }

let n = 0
const newPhone = () => `+26134${String(process.pid % 1000).padStart(3, '0')}${String(++n).padStart(4, '0')}`
const local = (e164) => `0${e164.slice(4, 6)} ${e164.slice(6, 8)} ${e164.slice(8, 11)} ${e164.slice(11)}`

async function waitFor(fn, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) {
    const v = await fn()
    if (v) return v
  }
  throw new Error('délai dépassé')
}
const codeIn = (msg) => msg.text.match(/\b(\d{6})\b/)[1]
const lastSms = (ctx, phone, after = 0) => waitFor(() => ctx.texts.slice(after).findLast((m) => m.to === phone))
const register = (ctx, phone, extra = {}) =>
  call(ctx.app, 'POST', '/api/auth/phone/register', { body: { phone, name: 'Rasoa', password: PASSWORD, consent: true, ...extra } })
const login = (ctx, phone, password = PASSWORD) => call(ctx.app, 'POST', '/api/auth/login', { body: { phone, password } })
const confirm = (ctx, phone, code) => call(ctx.app, 'POST', '/api/auth/phone/confirm', { body: { phone, code } })
const resetSmsQuota = (ctx) => ctx.db.query("DELETE FROM security_quotas WHERE name = 'sms'")

async function phoneUser(ctx) {
  const phone = newPhone()
  const before = ctx.texts.length
  assert.equal((await register(ctx, phone)).statusCode, 202)
  const code = codeIn(await lastSms(ctx, phone, before))
  assert.equal((await confirm(ctx, phone, code)).statusCode, 200)
  const r = await login(ctx, phone)
  assert.equal(r.statusCode, 200, r.body)
  return { phone, cookie: cookieOf(r), id: r.json().user.id }
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
async function timed(fn) { const t = performance.now(); const r = await fn(); return { r, ms: performance.now() - t } }

let dbh, ctx
test.before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, OPEN) })
test.after(async () => { await ctx?.close(); dbh?.stop() })

test('parcours : inscription par numéro → code dans la boîte SMS locale → numéro confirmé → connexion web et native', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sms-outbox-'))
  const outbox = join(dir, 'sms.jsonl')
  const app = await startApp(dbh.url, { ...OPEN, SMS_PROVIDER: 'fake', SMS_OUTBOX: outbox })
  try {
    const phone = newPhone()
    // Forme locale acceptée, normalisée en E.164 avant tout usage.
    const r = await register(app, local(phone), { lang: 'fr' })
    assert.equal(r.statusCode, 202, r.body)
    assert.deepEqual(r.json(), { codeRequired: true, message: 'Un code de confirmation vous a été envoyé par SMS.' })
    const line = await waitFor(() => existsSync(outbox) && readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((m) => m.to === phone))
    assert.match(line.text, /^Mon app : votre code de confirmation est \d{6}\./)
    assert.ok(!line.text.includes('Rasoa') && !line.text.includes(phone.slice(4)), 'aucune donnée du compte dans le SMS')
    const code = codeIn(line)
    assert.ok(!r.body.includes(code), 'jamais le code dans la réponse')

    // Avant confirmation : mot de passe juste mais numéro non confirmé (dit après le mot de passe seulement).
    const early = await login(app, phone)
    assert.equal(early.statusCode, 403)
    assert.equal(early.json().code, 'phone_unverified')
    assert.equal((await login(app, phone, 'mauvais mot de passe long')).statusCode, 401)

    const ok = await confirm(app, local(phone), code)
    assert.equal(ok.statusCode, 200, ok.body)
    assert.deepEqual(ok.json(), { message: 'Numéro confirmé. Vous pouvez vous connecter.', phone })
    // Rejeu du même code : refusé.
    assert.equal((await confirm(app, phone, code)).statusCode, 400)

    const web = await login(app, phone)
    assert.equal(web.statusCode, 200, web.body)
    assert.deepEqual(web.json().user, { id: web.json().user.id, email: null, phone, name: 'Rasoa', is_admin: false, lang: 'fr' })
    const me = await call(app.app, 'GET', '/api/auth/me', { cookie: cookieOf(web) })
    assert.equal(me.json().user.phone, phone)
    const nat = await native(app.app, 'POST', '/api/auth/native/login', { body: { phone, password: PASSWORD } })
    assert.equal(nat.statusCode, 200, nat.body)
    assert.equal(nat.json().user.phone, phone)
    const renewed = await native(app.app, 'POST', '/api/auth/native/refresh', { body: { refreshToken: nat.json().refreshToken } })
    assert.equal(renewed.json().user.phone, phone)
    // Une famille se crée comme pour un compte à adresse.
    assert.equal((await call(app.app, 'POST', '/api/families', { cookie: cookieOf(web), body: { name: 'Fianakaviana' } })).statusCode, 201)
    // Les deux identifiants à la fois, ou aucun : refusé.
    assert.equal((await call(app.app, 'POST', '/api/auth/login', { body: { phone, email: 'a@b.fr', password: PASSWORD } })).statusCode, 400)
    assert.equal((await call(app.app, 'POST', '/api/auth/login', { body: { password: PASSWORD } })).statusCode, 400)
    // Champ inconnu sur les deux connexions : 400, jamais ignoré (affectation de masse).
    const extra = await call(app.app, 'POST', '/api/auth/login', { body: { phone, password: PASSWORD, is_admin: true } })
    assert.equal(extra.statusCode, 400)
    assert.match(extra.json().error, /Champ non accepté : is_admin/)
    assert.equal((await native(app.app, 'POST', '/api/auth/native/login', { body: { phone, password: PASSWORD, role: 'owner' } })).statusCode, 400)
    // Autre écriture du même numéro (plusieurs 0 nationaux) : le même compte, jamais un second.
    const zeros = `+261 00 ${phone.slice(4)}`
    const same = await login(app, zeros)
    assert.equal(same.statusCode, 200)
    assert.equal(same.json().user.phone, phone)
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('entrées : champ inconnu, numéro invalide, consentement absent → 400 avant tout envoi', async () => {
  const phone = newPhone(), before = ctx.texts.length
  assert.equal((await register(ctx, phone, { is_admin: true })).statusCode, 400)
  assert.equal((await register(ctx, '12345')).json().code, 'invalid_phone')
  assert.equal((await register(ctx, phone, { consent: false })).json().code, 'consent_required')
  assert.equal((await register(ctx, phone, { password: 'court' })).statusCode, 400)
  // Le numéro lui-même (ou sous sa forme nationale, espacée) n'est pas un mot de passe.
  for (const password of [`${phone}xyz`, `mon numero ${local(phone)}`]) {
    const r = await register(ctx, phone, { password })
    assert.equal(r.statusCode, 400, password)
    assert.match(r.json().error, /numéro/)
  }
  assert.equal((await confirm(ctx, phone, '12a456')).json().code, 'invalid_code')
  assert.equal((await call(ctx.app, 'POST', '/api/auth/phone/resend', { body: { phone, code: '123456' } })).statusCode, 400)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(ctx.texts.length, before, 'aucun SMS')
})

test('énumération : numéro connu ou inconnu → même réponse, même durée (inscription, connexion, renvoi)', async () => {
  const known = await phoneUser(ctx)
  const unverified = newPhone()
  assert.equal((await register(ctx, unverified)).statusCode, 202)

  // Inscription : numéro déjà pris (le titulaire reçoit « vous avez déjà un compte ») ou neuf.
  const k = [], u = []
  for (let i = 0; i < 4; i++) {
    const before = ctx.texts.length
    k.push(await timed(() => register(ctx, known.phone)))
    const already = await lastSms(ctx, known.phone, before)
    assert.match(already.text, /already has an account|efa manana kaonty/)
    assert.doesNotMatch(already.text, /\d{6}/, 'aucun code pour un numéro déjà pris')
    u.push(await timed(() => register(ctx, newPhone())))
  }
  for (const { r } of [...k, ...u]) {
    assert.equal(r.statusCode, 202)
    assert.equal(r.body, k[0].r.body)
  }
  const dReg = Math.abs(median(k.map((x) => x.ms)) - median(u.map((x) => x.ms)))
  assert.ok(dReg < 150, `inscription : écart médian ${dReg.toFixed(0)} ms`)
  // Le compte existant n'est ni repris ni modifié.
  assert.equal((await login(ctx, known.phone)).statusCode, 200)

  // Connexion : numéro inconnu ou mot de passe faux → même 401, même durée (hachage factice).
  const lk = [], lu = []
  for (let i = 0; i < 5; i++) {
    lk.push(await timed(() => login(ctx, known.phone, 'mot de passe faux et long')))
    lu.push(await timed(() => login(ctx, newPhone(), 'mot de passe faux et long')))
  }
  for (const { r } of [...lk, ...lu]) {
    assert.equal(r.statusCode, 401)
    assert.deepEqual(r.json(), { error: 'Numéro ou mot de passe incorrect.' })
  }
  const dLogin = Math.abs(median(lk.map((x) => x.ms)) - median(lu.map((x) => x.ms)))
  assert.ok(dLogin < 150, `connexion : écart médian ${dLogin.toFixed(0)} ms`)

  // Renvoi du code : en attente de confirmation, confirmé, inconnu → même réponse et durée.
  await new Promise((r) => setTimeout(r, 1100)) // délai minimal entre deux envois au même numéro
  const rs = []
  for (const phone of [unverified, known.phone, newPhone()]) rs.push(await timed(() => call(ctx.app, 'POST', '/api/auth/phone/resend', { body: { phone } })))
  for (const { r } of rs) { assert.equal(r.statusCode, 202); assert.equal(r.body, rs[0].r.body) }
  const spread = Math.max(...rs.map((x) => x.ms)) - Math.min(...rs.map((x) => x.ms))
  assert.ok(spread < 150, `renvoi : écart ${spread.toFixed(0)} ms`)
  await waitFor(() => ctx.texts.findLast((m) => m.to === unverified && /\d{6}/.test(m.text)))
})

test('essais : 5 codes faux puis le bon → invalidé ; un nouveau code repart de zéro', async () => {
  const phone = newPhone()
  const before = ctx.texts.length
  await register(ctx, phone)
  const code = codeIn(await lastSms(ctx, phone, before))
  const wrong = code === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) {
    const r = await confirm(ctx, phone, wrong)
    assert.equal(r.statusCode, 400)
    assert.equal(r.json().code, 'invalid_code')
  }
  const sixth = await confirm(ctx, phone, code)
  assert.equal(sixth.statusCode, 400, '6e essai, même avec le bon code : refusé')
  assert.deepEqual(sixth.json(), (await confirm(ctx, newPhone(), code)).json(), 'même réponse que pour un numéro inconnu')
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM phone_codes WHERE phone = $1', [phone])).rows[0].n, 0, 'code supprimé')

  await new Promise((r) => setTimeout(r, 1100))
  const mark = ctx.texts.length
  assert.equal((await call(ctx.app, 'POST', '/api/auth/phone/resend', { body: { phone, lang: 'en' } })).statusCode, 202)
  const fresh = await lastSms(ctx, phone, mark)
  assert.match(fresh.text, /^Mon app: your confirmation code is \d{6}\./)
  assert.equal((await confirm(ctx, phone, codeIn(fresh))).statusCode, 200)
  // Code échu : refusé.
  const other = newPhone(), m2 = ctx.texts.length
  await register(ctx, other)
  const late = codeIn(await lastSms(ctx, other, m2))
  await ctx.db.query("UPDATE phone_codes SET expires_at = now() - interval '1 second' WHERE phone = $1", [other])
  assert.equal((await confirm(ctx, other, late)).statusCode, 400)
})

test('concurrence : deux confirmations simultanées du bon code → une seule réussit', async () => {
  for (let round = 0; round < 3; round++) {
    const phone = newPhone(), before = ctx.texts.length
    await register(ctx, phone)
    const code = codeIn(await lastSms(ctx, phone, before))
    const results = await Promise.all([confirm(ctx, phone, code), confirm(ctx, phone, code)])
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400])
  }
})

test('limites par numéro : délai minimal entre deux envois, 3 par heure ; refus sans SMS', async () => {
  const app = await startApp(dbh.url, { ...OPEN, SMS_PER_NUMBER_PER_HOUR: '3', SMS_RESEND_SECONDS: '60' })
  try {
    const phone = newPhone()
    assert.equal((await register(app, phone)).statusCode, 202)
    await lastSms(app, phone)
    const resend = () => call(app.app, 'POST', '/api/auth/phone/resend', { body: { phone } })
    const soon = await resend()
    assert.equal(soon.statusCode, 429)
    assert.equal(soon.json().code, 'sms_rate_limited')
    const back = () => app.db.query("UPDATE phone_send_limits SET last_sent_at = now() - interval '2 minutes' WHERE phone = $1", [phone])
    await back(); assert.equal((await resend()).statusCode, 202)
    await back(); assert.equal((await resend()).statusCode, 202)
    await back()
    const before = (await waitFor(() => app.texts.filter((m) => m.to === phone).length >= 3 && app.texts.length))
    const fourth = await resend()
    assert.equal(fourth.statusCode, 429, '4e envoi dans l’heure')
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(app.texts.length, before, 'aucun SMS au-delà de la limite')
    // Même limite pour un numéro sans compte (aucune différence observable).
    const nobody = newPhone()
    assert.equal((await call(app.app, 'POST', '/api/auth/phone/resend', { body: { phone: nobody } })).statusCode, 202)
    assert.equal((await call(app.app, 'POST', '/api/auth/phone/resend', { body: { phone: nobody } })).statusCode, 429)
    // Fenêtre échue : de nouveau permis.
    await app.db.query("UPDATE phone_send_limits SET window_expires_at = now(), last_sent_at = now() - interval '2 minutes' WHERE phone = $1", [phone])
    assert.equal((await resend()).statusCode, 202)
  } finally { await app.close() }
})

test('limites par IP (/64) et globale (persistée, alerte) ; refus sans SMS', async () => {
  const perIp = await startApp(dbh.url, { ...OPEN, SMS_PER_IP_PER_HOUR: '2', TRUST_PROXY: '127.0.0.1' })
  try {
    const from = (ip, phone) => call(perIp.app, 'POST', '/api/auth/phone/resend', { body: { phone }, headers: { 'x-forwarded-for': ip } })
    assert.equal((await from('2001:db8:1:2::1', newPhone())).statusCode, 202)
    assert.equal((await from('2001:db8:1:2::ffff', newPhone())).statusCode, 202)
    assert.equal((await from('2001:db8:1:2:aaaa::3', newPhone())).statusCode, 429, 'même /64')
    assert.equal((await from('2001:db8:1:3::1', newPhone())).statusCode, 202, 'autre /64')
    const before = perIp.texts.length
    assert.equal((await perIp.app.inject({ method: 'POST', url: '/api/auth/phone/register', headers: { origin: 'https://app.test', 'x-app': '1', 'x-forwarded-for': '2001:db8:1:2::9' }, payload: { phone: newPhone(), name: 'X', password: PASSWORD, consent: true } })).statusCode, 429)
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(perIp.texts.length, before)
  } finally { await perIp.close() }

  await resetSmsQuota(ctx)
  const global = await startApp(dbh.url, { ...OPEN, SMS_PER_HOUR: '2' })
  try {
    for (let i = 0; i < 2; i++) assert.equal((await register(global, newPhone())).statusCode, 202)
    await waitFor(() => global.texts.length >= 2)
    const phone = newPhone()
    const r = await register(global, phone)
    assert.equal(r.statusCode, 429)
    await new Promise((res) => setTimeout(res, 100))
    assert.equal(global.texts.length, 2, 'aucun SMS au-delà du quota global')
    assert.equal((await global.db.query('SELECT count(*)::int AS n FROM users WHERE phone = $1', [phone])).rows[0].n, 0)
    assert.equal((await global.db.query("SELECT count(*)::int AS n FROM security_alerts WHERE kind = 'sms_quota'")).rows[0].n, 1, 'alerte de supervision')
  } finally { await global.close(); await resetSmsQuota(ctx) }
})

test('journal : aucun code SMS ni numéro dans la sortie du logger', async () => {
  let output = ''
  const stream = new Writable({ write(chunk, _enc, cb) { output += chunk.toString(); cb() } })
  const app = await startApp(dbh.url, OPEN, { logger: { stream } })
  try {
    const phone = newPhone(), before = app.texts.length
    await register(app, phone)
    const code = codeIn(await lastSms(app, phone, before))
    await confirm(app, phone, code === '000000' ? '111111' : '000000')
    await confirm(app, phone, code)
    await login(app, phone)
    await login(app, phone, 'mot de passe faux et long')
    await new Promise((r) => setTimeout(r, 1100))
    await call(app.app, 'POST', '/api/auth/phone/resend', { body: { phone } })
    // Envoi en échec dans la file : message générique seulement.
    app.app.sms.send = async () => { throw new Error(`échec ${code} ${phone}`) }
    await new Promise((r) => setTimeout(r, 1100))
    await register(app, phone)
    await new Promise((r) => setTimeout(r, 100))
    assert.ok(output.includes('/api/auth/phone/confirm'), 'le journal a bien capturé les requêtes')
    assert.ok(!output.includes(code), 'aucun code dans le journal')
    assert.ok(!output.includes(phone.slice(1)), 'aucun numéro dans le journal')
  } finally { await app.close() }
})

test('compte à numéro : mot de passe redemandé par la garde du numéro, suppression du compte', async () => {
  const u = await phoneUser(ctx)
  const wrong = await call(ctx.app, 'DELETE', '/api/auth/me', { cookie: u.cookie, body: { password: 'mot de passe faux et long' } })
  assert.equal(wrong.json().code, 'wrong_password')
  const gone = await call(ctx.app, 'DELETE', '/api/auth/me', { cookie: u.cookie, body: { password: PASSWORD } })
  assert.equal(gone.statusCode, 200, gone.body)
  assert.equal((await login(ctx, u.phone)).statusCode, 401)
})

test('équipe : un compte à numéro apparaît sans son numéro (liste des comptes, journal d’audit)', async () => {
  const u = await phoneUser(ctx)
  const admin = await newUser(ctx, { admin: true })
  const users = await call(ctx.app, 'GET', '/api/admin/users', { cookie: admin.cookie })
  assert.equal(users.statusCode, 200)
  const row = users.json().find((r) => r.id === u.id)
  assert.deepEqual([row.email, row.sms_account, row.verified], [null, true, true])
  const audit = await call(ctx.app, 'GET', '/api/admin/audit', { cookie: admin.cookie })
  for (const r of [users, audit]) assert.ok(!r.body.includes(u.phone.slice(4)), 'aucun numéro vers l’équipe')
  assert.ok(audit.json().some((e) => e.actor === u.id || e.target === u.id))
})

test('configuration : fournisseur factice et boîte SMS refusés en production ; aucun fournisseur → 503 sans lecture', async () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_ORIGIN: 'https://app.test', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), DATA_ENCRYPTION_KEY: 'cd'.repeat(32), TRUST_PROXY: '10.0.0.0/8', PUSH_PROVIDER: 'none' }
  assert.throws(() => loadConfig({ ...prod, SMS_PROVIDER: 'fake' }), /interdit en production/)
  assert.throws(() => loadConfig({ ...prod, SMS_PROVIDER: 'none', SMS_OUTBOX: '/tmp/x' }), /interdit en production/)
  assert.throws(() => loadConfig({ ...prod, SMS_PROVIDER: 'twilio' }), /SMS_PROVIDER/)
  assert.equal(loadConfig(prod).sms.provider, 'none', 'production sans choix : aucun envoi')
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x' }).sms.provider, 'fake', 'fake par défaut hors production')
  assert.throws(() => createSms({ production: true, sms: { provider: 'fake', outbox: '' } }), /interdit en production/)

  const off = await startApp(dbh.url, { ...OPEN, SMS_PROVIDER: 'none' })
  try {
    const r = await register(off, newPhone())
    assert.equal(r.statusCode, 503)
    assert.equal(r.json().code, 'sms_unavailable')
    assert.equal((await call(off.app, 'POST', '/api/auth/phone/resend', { body: { phone: newPhone() } })).json().code, 'sms_unavailable')
  } finally { await off.close() }
})

test('SMS : un seul message GSM 7 bits par texte, dans les trois langues', () => {
  const t = smsTexts('Akaiky')
  const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n]*$/
  for (const lang of ['mg', 'fr', 'en']) {
    for (const s of [t.confirm('123456', lang), t.alreadyRegistered(lang)]) {
      assert.ok(s.length <= 160, `${lang} : ${s.length} caractères`)
      assert.match(s, GSM, s)
    }
  }
  assert.equal(t.confirm('123456', 'xx'), t.confirm('123456', 'mg'), 'malgache par défaut')
})

test('PostgreSQL : parcours par numéro sous le rôle restreint ; numéro et codes non modifiables', async () => {
  const db = await startDb(), admin = await startApp(db.url)
  let runtime
  try {
    const sql = (await readFile(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8')).replace(":'runtime_password'", "'runtime-test-only'")
    await admin.db.query(sql)
    const url = new URL(db.url); url.username = 'app_runtime'; url.password = 'runtime-test-only'
    const pool = createPool(url.toString())
    await verifySchema(pool)
    const config = loadConfig({ DATABASE_URL: url.toString(), APP_ORIGIN: 'https://app.test', ...OPEN, RATE_LIMIT_IP: '10000', RATE_LIMIT_EMAIL: '10000' })
    const texts = []
    const app = await buildApp({ config, db: pool, mailer: { async send() {} }, sms: { available: true, sent: texts, async send(m) { texts.push(m) } }, logger: false })
    runtime = { app, db: pool, texts }
    const u = await phoneUser(runtime)
    assert.equal((await call(app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user.id, u.id)
    await new Promise((r) => setTimeout(r, 1100))
    assert.equal((await call(app, 'POST', '/api/auth/phone/resend', { body: { phone: u.phone } })).statusCode, 202)
    // Réinitialisation par SMS (NAR-201) sous le rôle restreint : mot de passe, confirmation,
    // sessions, appareils, défis MFA et codes, avec les seuls droits accordés.
    await new Promise((r) => setTimeout(r, 1100))
    const mark = texts.length
    assert.equal((await call(app, 'POST', '/api/auth/phone/forgot', { body: { phone: u.phone } })).statusCode, 202)
    const resetSms = await waitFor(() => texts.slice(mark).find((m) => m.to === u.phone && /\d{6}/.test(m.text)))
    const done = await call(app, 'POST', '/api/auth/phone/reset', { body: { phone: u.phone, code: codeIn(resetSms), password: 'vorona manidina ambony rano' } })
    assert.equal(done.statusCode, 200, done.body)
    assert.equal((await call(app, 'GET', '/api/auth/me', { cookie: u.cookie })).json().user, null)
    assert.equal((await login(runtime, u.phone, 'vorona manidina ambony rano')).statusCode, 200)
    await assert.rejects(pool.query("UPDATE users SET phone = '+261340000000'"), /permission denied/)
    await assert.rejects(pool.query("UPDATE phone_codes SET phone = '+261340000000'"), /permission denied/)
    await assert.rejects(pool.query("UPDATE phone_codes SET purpose = 'reset'"), /permission denied/)
    await assert.rejects(pool.query('DELETE FROM phone_send_limits'), /permission denied/)
    const { rows } = await admin.db.query(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE grantee = 'app_runtime' AND table_name = 'users' AND privilege_type = 'UPDATE' ORDER BY column_name`)
    assert.ok(!rows.some((r) => r.column_name === 'phone'))
    assert.ok(rows.some((r) => r.column_name === 'phone_verified_at'))
    // La purge tourne avec les nouvelles tables (fonction de 027).
    const purge = (await pool.query('SELECT purge_expired() AS r')).rows[0].r
    assert.ok(purge === null || typeof purge.phoneCodes === 'number')
  } finally {
    if (runtime) { await runtime.app.close(); await runtime.db.end() }
    await admin.close(); db.stop()
  }
})
