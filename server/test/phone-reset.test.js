// Réinitialisation du mot de passe par code SMS (NAR-201, tranche 2 de NAR-136) : parcours,
// sessions fermées (cookie et Bearer), appareils de confiance révoqués, MFA gardée, audit,
// SMS « mot de passe modifié », règles du mot de passe, énumération (réponse et durée),
// essais, concurrence, reprise d'un numéro non confirmé, limites partagées, journal, 503.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { startDb, startApp, call, native, cookieOf } from './helpers.js'
import { smsTexts } from '../src/sms.js'

const PASSWORD = 'tsara ny andro anio maraina'
const NEW_PASSWORD = 'vorona manidina ambony rano'
const OPEN = { SMS_PER_IP_PER_HOUR: '10000', SMS_PER_NUMBER_PER_HOUR: '1000', SMS_RESEND_SECONDS: '1', SMS_PER_HOUR: '100000', REGISTRATIONS_PER_HOUR: '100000' }

let n = 0
// Plage distincte de phone-auth.test.js (+26134…) : les deux fichiers peuvent partager une base.
const newPhone = () => `+26133${String(process.pid % 1000).padStart(3, '0')}${String(++n).padStart(4, '0')}`
const local = (e164) => `0${e164.slice(4, 6)} ${e164.slice(6, 8)} ${e164.slice(8, 11)} ${e164.slice(11)}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) {
    const v = await fn()
    if (v) return v
  }
  throw new Error('délai dépassé')
}
const codeIn = (msg) => msg.text.match(/\b(\d{6})\b/)[1]
const lastSms = (ctx, phone, after = 0, re = /./) => waitFor(() => ctx.texts.slice(after).findLast((m) => m.to === phone && re.test(m.text)))
const RESET_SMS = /reset code|changer de mot de passe|hanovana ny tenimiafinao/
const register = (ctx, phone, password = PASSWORD) =>
  call(ctx.app, 'POST', '/api/auth/phone/register', { body: { phone, name: 'Rasoa', password, consent: true } })
const login = (ctx, phone, password = PASSWORD, extra = {}) => call(ctx.app, 'POST', '/api/auth/login', { body: { phone, password, ...extra } })
const confirm = (ctx, phone, code) => call(ctx.app, 'POST', '/api/auth/phone/confirm', { body: { phone, code } })
const forgot = (ctx, phone, extra = {}) => call(ctx.app, 'POST', '/api/auth/phone/forgot', { body: { phone, ...extra } })
const reset = (ctx, phone, code, password = NEW_PASSWORD, extra = {}, headers = {}) =>
  call(ctx.app, 'POST', '/api/auth/phone/reset', { body: { phone, code, password, ...extra }, headers })
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
async function timed(fn) { const t = performance.now(); const r = await fn(); return { r, ms: performance.now() - t } }
const wrongOf = (code) => code === '000000' ? '111111' : '000000'

async function phoneUser(ctx) {
  const phone = newPhone()
  const before = ctx.texts.length
  assert.equal((await register(ctx, phone)).statusCode, 202)
  assert.equal((await confirm(ctx, phone, codeIn(await lastSms(ctx, phone, before)))).statusCode, 200)
  const r = await login(ctx, phone)
  assert.equal(r.statusCode, 200, r.body)
  return { phone, cookie: cookieOf(r), id: r.json().user.id }
}
// Demande un code de réinitialisation et le lit dans la boîte SMS locale.
async function resetCode(ctx, phone, extra = {}) {
  const before = ctx.texts.length
  const r = await forgot(ctx, phone, extra)
  assert.equal(r.statusCode, 202, r.body)
  return codeIn(await lastSms(ctx, phone, before, RESET_SMS))
}

let dbh, ctx
test.before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { ...OPEN, TRUST_PROXY: '127.0.0.1' }) })
test.after(async () => { await ctx?.close(); dbh?.stop() })

test('parcours : code SMS → nouveau mot de passe ; sessions cookie et Bearer fermées, appareils révoqués, MFA gardée, audit, SMS « modifié », pas de session', async () => {
  const u = await phoneUser(ctx)
  // Seconde session web avec appareil de confiance, et session native (Bearer + renouvellement).
  const remembered = await login(ctx, u.phone, PASSWORD, { rememberDevice: true })
  assert.equal(remembered.statusCode, 200)
  const nat = await native(ctx.app, 'POST', '/api/auth/native/login', { body: { phone: u.phone, password: PASSWORD } })
  assert.equal(nat.statusCode, 200, nat.body)
  const { accessToken, refreshToken } = nat.json()
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: accessToken })).json().user.id, u.id)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM trusted_devices WHERE user_id = $1', [u.id])).rows[0].n, 1)
  // Second facteur posé directement : la réinitialisation doit le garder.
  await ctx.db.query("INSERT INTO mfa_factors(user_id, secret) VALUES ($1, 'graine-de-test')", [u.id])

  await sleep(1100) // délai minimal entre deux envois au même numéro
  const before = ctx.texts.length
  const asked = await forgot(ctx, local(u.phone), { lang: 'fr' })
  assert.equal(asked.statusCode, 202)
  assert.deepEqual(asked.json(), { message: 'Si ce numéro correspond à un compte, un code vient de lui être envoyé par SMS.' })
  const sms = await lastSms(ctx, u.phone, before, RESET_SMS)
  assert.match(sms.text, /^Mon app : votre code pour changer de mot de passe est \d{6}\./)
  const code = codeIn(sms)
  assert.ok(!asked.body.includes(code) && !asked.body.includes(u.phone.slice(4)), 'ni code ni numéro dans la réponse')

  const mark = ctx.texts.length
  const done = await reset(ctx, local(u.phone), code, NEW_PASSWORD, { lang: 'fr' })
  assert.equal(done.statusCode, 200, done.body)
  assert.deepEqual(done.json(), { message: 'Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.' })
  assert.ok(!done.body.includes(code) && !done.body.includes(u.phone.slice(4)), 'ni code ni numéro dans la réponse')
  // Pas de session ouverte : le seul cookie posé efface la session.
  const cookies = [].concat(done.headers['set-cookie'] || [])
  assert.ok(cookies.length >= 1 && cookies.every((c) => /Max-Age=0/i.test(c)), cookies.join(' | '))

  // Anciennes sessions refusées : cookie (les deux), Bearer, renouvellement natif.
  for (const cookie of [u.cookie, cookieOf(remembered)]) {
    assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie })).json().user, null)
    assert.equal((await call(ctx.app, 'POST', '/api/families', { cookie, body: { name: 'X' } })).statusCode, 401)
  }
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: accessToken })).json().user, null)
  assert.equal((await native(ctx.app, 'POST', '/api/auth/native/refresh', { body: { refreshToken } })).statusCode, 401)
  const left = (table) => ctx.db.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [u.id]).then((r) => r.rows[0].n)
  assert.equal(await left('sessions'), 0)
  assert.equal(await left('trusted_devices'), 0, 'appareils de confiance révoqués')
  assert.equal(await left('mfa_factors'), 1, 'MFA gardée')

  // SMS « mot de passe modifié », sans code.
  const changed = await lastSms(ctx, u.phone, mark)
  assert.match(changed.text, /^Mon app : le mot de passe de votre compte vient d'etre modifie\./)
  assert.doesNotMatch(changed.text, /\d{6}/)
  // Audité, sans numéro.
  const { rows: audit } = await ctx.db.query("SELECT details FROM audit_log WHERE action = 'password_reset' AND target = $1", [u.id])
  assert.deepEqual(audit.map((r) => r.details), [{ channel: 'sms', reclaimed: false }])
  assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'reset_requested' AND target = $1", [u.id])).rows[0].n, 1)

  // Ancien mot de passe refusé ; le nouveau mène au second facteur (MFA gardée), pas à une session.
  assert.equal((await login(ctx, u.phone)).statusCode, 401)
  const again = await login(ctx, u.phone, NEW_PASSWORD)
  assert.equal(again.statusCode, 200, again.body)
  assert.equal(again.json().mfaRequired, true)
  assert.equal(again.json().enrollmentRequired, false)
  // Code rejoué : refusé.
  assert.equal((await reset(ctx, u.phone, code, 'encore un autre mot de passe')).json().code, 'invalid_code')
})

test('entrées : champ inconnu, numéro invalide, mot de passe refusé (court, numéro dedans) → 400 sans consommer le code', async () => {
  const u = await phoneUser(ctx)
  await sleep(1100)
  const code = await resetCode(ctx, u.phone)
  const before = ctx.texts.length
  assert.match((await forgot(ctx, u.phone, { code: '123456' })).json().error, /Champ non accepté : code/)
  assert.match((await reset(ctx, u.phone, code, NEW_PASSWORD, { is_admin: true })).json().error, /Champ non accepté : is_admin/)
  assert.equal((await reset(ctx, '12345', code)).json().code, 'invalid_phone')
  assert.equal((await forgot(ctx, '12345')).json().code, 'invalid_phone')
  assert.equal((await reset(ctx, u.phone, code, 'court')).statusCode, 400)
  for (const password of [`${u.phone}xyz`, `mon numero ${local(u.phone)}`]) {
    const r = await reset(ctx, u.phone, code, password)
    assert.equal(r.statusCode, 400, password)
    assert.match(r.json().error, /numéro/)
  }
  assert.equal((await reset(ctx, u.phone, '12a456')).json().code, 'invalid_code')
  assert.equal((await reset(ctx, u.phone, 123456)).json().code, 'invalid_code')
  const row = (await ctx.db.query("SELECT attempts FROM phone_codes WHERE phone = $1 AND purpose = 'reset'", [u.phone])).rows[0]
  assert.equal(row.attempts, 0, 'aucun essai décompté par une entrée refusée')
  await sleep(50)
  assert.equal(ctx.texts.length, before, 'aucun SMS')
  assert.equal((await reset(ctx, u.phone, code)).statusCode, 200)
})

test('énumération : numéro confirmé, non confirmé ou inconnu → même réponse, même durée (demande et saisie du code)', async () => {
  const known = await phoneUser(ctx)
  const pending = newPhone()
  assert.equal((await register(ctx, pending)).statusCode, 202)
  await sleep(1100)

  // Demande : trois numéros, à tour de rôle ; délai minimal respecté entre deux envois.
  const asked = { known: [], pending: [], unknown: [] }
  for (let i = 0; i < 3; i++) {
    asked.known.push(await timed(() => forgot(ctx, known.phone)))
    asked.pending.push(await timed(() => forgot(ctx, pending)))
    asked.unknown.push(await timed(() => forgot(ctx, newPhone())))
    await sleep(1050)
  }
  const all = Object.values(asked).flat()
  for (const { r } of all) { assert.equal(r.statusCode, 202, r.body); assert.equal(r.body, all[0].r.body) }
  const meds = Object.values(asked).map((xs) => median(xs.map((x) => x.ms)))
  assert.ok(Math.max(...meds) - Math.min(...meds) < 150, `demande : médianes ${meds.map((m) => m.toFixed(0)).join(' / ')} ms`)
  // Seuls les numéros qui ont un compte reçoivent un code.
  await lastSms(ctx, known.phone, 0, RESET_SMS)
  await lastSms(ctx, pending, 0, RESET_SMS)

  // Saisie du code : inconnu, compte sans code en cours, code faux → même 400, même durée.
  const noCode = await phoneUser(ctx)
  const cases = { unknown: [], noCode: [], wrong: [] }
  const code = (await ctx.db.query("SELECT 1 FROM phone_codes WHERE phone = $1 AND purpose = 'reset'", [known.phone])).rows.length
  assert.equal(code, 1)
  for (let i = 0; i < 4; i++) {
    cases.unknown.push(await timed(() => reset(ctx, newPhone(), '123456')))
    cases.noCode.push(await timed(() => reset(ctx, noCode.phone, '123456')))
    // 4 essais faux au plus : le code n'est pas épuisé.
    cases.wrong.push(await timed(() => reset(ctx, known.phone, '123456')))
  }
  const fails = Object.values(cases).flat()
  for (const { r } of fails) {
    assert.equal(r.statusCode, 400)
    assert.equal(r.body, fails[0].r.body)
    assert.equal(r.json().code, 'invalid_code')
  }
  const fm = Object.values(cases).map((xs) => median(xs.map((x) => x.ms)))
  assert.ok(Math.max(...fm) - Math.min(...fm) < 150, `saisie : médianes ${fm.map((m) => m.toFixed(0)).join(' / ')} ms`)
  // Le compte connu n'a pas bougé.
  assert.equal((await login(ctx, known.phone)).statusCode, 200)
})

test('essais : 5 codes faux puis le bon → refusé, code supprimé ; un nouveau code repart de zéro ; code échu refusé', async () => {
  const u = await phoneUser(ctx)
  await sleep(1100)
  const code = await resetCode(ctx, u.phone)
  for (let i = 0; i < 5; i++) assert.equal((await reset(ctx, u.phone, wrongOf(code))).json().code, 'invalid_code')
  const sixth = await reset(ctx, u.phone, code)
  assert.equal(sixth.statusCode, 400, '6e essai, même avec le bon code : refusé')
  assert.equal(sixth.body, (await reset(ctx, newPhone(), code)).body, 'même réponse que pour un numéro inconnu')
  assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM phone_codes WHERE phone = $1 AND purpose = 'reset'", [u.phone])).rows[0].n, 0)
  assert.equal((await login(ctx, u.phone)).statusCode, 200, 'mot de passe inchangé')

  // Essais comptés atomiquement : 8 saisies fausses simultanées n'en laissent passer que 5.
  // Une IP par saisie : deux hachages simultanés au plus par source (app.js, HASHING).
  await sleep(1100)
  const burst = await resetCode(ctx, u.phone)
  await Promise.all(Array.from({ length: 8 }, (_, i) =>
    reset(ctx, u.phone, wrongOf(burst), NEW_PASSWORD, {}, { 'x-forwarded-for': `198.51.100.${10 + i}` })))
  assert.equal((await reset(ctx, u.phone, burst)).statusCode, 400, 'épuisé malgré la concurrence')

  await sleep(1100)
  const fresh = await resetCode(ctx, u.phone)
  await ctx.db.query("UPDATE phone_codes SET expires_at = now() - interval '1 second' WHERE phone = $1 AND purpose = 'reset'", [u.phone])
  assert.equal((await reset(ctx, u.phone, fresh)).statusCode, 400, 'code échu')
  await sleep(1100)
  assert.equal((await reset(ctx, u.phone, await resetCode(ctx, u.phone))).statusCode, 200, 'nouveau code : essais remis à zéro')
})

// Chaque saisie calcule un scrypt (~128 Mo) avant même de lire le code : sans le plafond par
// source d'app.js, une rafale anonyme épuiserait la mémoire du serveur.
test('saisie du code : trois hachages simultanés depuis la même source → le troisième est refusé (429)', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.77' }
  const rs = await Promise.all(Array.from({ length: 3 }, () => reset(ctx, newPhone(), '123456', NEW_PASSWORD, {}, headers)))
  assert.deepEqual(rs.map((r) => r.statusCode).sort(), [400, 400, 429])
})

test('concurrence : deux réinitialisations simultanées avec le bon code → une seule réussit', async () => {
  for (let round = 0; round < 3; round++) {
    const u = await phoneUser(ctx)
    await sleep(1100)
    const code = await resetCode(ctx, u.phone)
    const [a, b] = await Promise.all([reset(ctx, u.phone, code, 'premier nouveau mot de passe'), reset(ctx, u.phone, code, 'second nouveau mot de passe')])
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 400])
    const winner = a.statusCode === 200 ? 'premier nouveau mot de passe' : 'second nouveau mot de passe'
    const loser = a.statusCode === 200 ? 'second nouveau mot de passe' : 'premier nouveau mot de passe'
    assert.equal((await login(ctx, u.phone, winner)).statusCode, 200)
    assert.equal((await login(ctx, u.phone, loser)).statusCode, 401)
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'password_reset' AND target = $1", [u.id])).rows[0].n, 1)
  }
})

test('numéro non confirmé inscrit par un tiers : le titulaire le reprend (numéro confirmé, mot de passe remplacé)', async () => {
  const phone = newPhone()
  // Le tiers inscrit le numéro avec son mot de passe et ne le confirme jamais.
  const mark = ctx.texts.length
  assert.equal((await register(ctx, phone, 'mot de passe du squatteur')).statusCode, 202)
  await lastSms(ctx, phone, mark)
  assert.equal((await login(ctx, phone, 'mot de passe du squatteur')).json().code, 'phone_unverified')
  const id = (await ctx.db.query('SELECT id FROM users WHERE phone = $1', [phone])).rows[0].id

  await sleep(1100)
  const code = await resetCode(ctx, phone)
  assert.equal((await reset(ctx, phone, code)).statusCode, 200)
  const row = (await ctx.db.query('SELECT phone_verified_at FROM users WHERE id = $1', [id])).rows[0]
  assert.ok(row.phone_verified_at, 'numéro confirmé par le code')
  assert.equal((await login(ctx, phone, 'mot de passe du squatteur')).statusCode, 401, 'mot de passe du tiers remplacé')
  const owner = await login(ctx, phone, NEW_PASSWORD)
  assert.equal(owner.statusCode, 200, owner.body)
  assert.equal(owner.json().user.id, id)
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM phone_codes WHERE phone = $1', [phone])).rows[0].n, 0, 'code de confirmation du tiers effacé')
  const { rows } = await ctx.db.query("SELECT details FROM audit_log WHERE action = 'password_reset' AND target = $1", [id])
  assert.deepEqual(rows.map((r) => r.details), [{ channel: 'sms', reclaimed: true }])
})

test('limites partagées avec l’inscription et le renvoi : par numéro (délai, nombre), par IP (/64), globale ; refus sans SMS', async () => {
  const perNumber = await startApp(dbh.url, { ...OPEN, SMS_PER_NUMBER_PER_HOUR: '3', SMS_RESEND_SECONDS: '60' })
  try {
    const phone = newPhone()
    assert.equal((await register(perNumber, phone)).statusCode, 202)
    await lastSms(perNumber, phone)
    const soon = await forgot(perNumber, phone)
    assert.equal(soon.statusCode, 429, 'délai minimal après l’inscription')
    assert.equal(soon.json().code, 'sms_rate_limited')
    const back = () => perNumber.db.query("UPDATE phone_send_limits SET last_sent_at = now() - interval '2 minutes' WHERE phone = $1", [phone])
    await back(); assert.equal((await call(perNumber.app, 'POST', '/api/auth/phone/resend', { body: { phone } })).statusCode, 202)
    await back(); assert.equal((await forgot(perNumber, phone)).statusCode, 202)
    await back()
    const before = await waitFor(() => perNumber.texts.filter((m) => m.to === phone).length >= 3 && perNumber.texts.length)
    assert.equal((await forgot(perNumber, phone)).statusCode, 429, '4e envoi dans l’heure, toutes routes confondues')
    // Même limite pour un numéro sans compte.
    const nobody = newPhone()
    assert.equal((await forgot(perNumber, nobody)).statusCode, 202)
    assert.equal((await forgot(perNumber, nobody)).statusCode, 429)
    await sleep(100)
    assert.equal(perNumber.texts.length, before, 'aucun SMS au-delà de la limite')
  } finally { await perNumber.close() }

  const perIp = await startApp(dbh.url, { ...OPEN, SMS_PER_IP_PER_HOUR: '2', TRUST_PROXY: '127.0.0.1' })
  try {
    const from = (ip, url, phone) => call(perIp.app, 'POST', url, { body: { phone }, headers: { 'x-forwarded-for': ip } })
    assert.equal((await from('2001:db8:5:6::1', '/api/auth/phone/resend', newPhone())).statusCode, 202)
    assert.equal((await from('2001:db8:5:6::2', '/api/auth/phone/forgot', newPhone())).statusCode, 202)
    assert.equal((await from('2001:db8:5:6:aaaa::3', '/api/auth/phone/forgot', newPhone())).statusCode, 429, 'même /64')
    assert.equal((await from('2001:db8:5:7::1', '/api/auth/phone/forgot', newPhone())).statusCode, 202, 'autre /64')
  } finally { await perIp.close() }

  await ctx.db.query("DELETE FROM security_quotas WHERE name = 'sms'")
  const global = await startApp(dbh.url, { ...OPEN, SMS_PER_HOUR: '2' })
  try {
    assert.equal((await register(global, newPhone())).statusCode, 202)
    assert.equal((await forgot(global, newPhone())).statusCode, 202)
    const r = await forgot(global, newPhone())
    assert.equal(r.statusCode, 429, 'quota global partagé')
    assert.equal((await global.db.query("SELECT count(*)::int AS n FROM security_alerts WHERE kind = 'sms_quota'")).rows[0].n, 1)
  } finally { await global.close(); await ctx.db.query("DELETE FROM security_quotas WHERE name = 'sms'") }

  // Saisie du code : limite par numéro de la route (RATE_LIMIT_EMAIL), en plus des 5 essais.
  const perKey = await startApp(dbh.url, { ...OPEN, RATE_LIMIT_EMAIL: '3' })
  try {
    const phone = newPhone()
    for (let i = 0; i < 3; i++) assert.equal((await reset(perKey, phone, '123456')).statusCode, 400)
    assert.equal((await reset(perKey, phone, '123456')).statusCode, 429)
  } finally { await perKey.close() }
})

test('journal : aucun code, numéro ni mot de passe dans la sortie du logger', async () => {
  let output = ''
  const stream = new Writable({ write(chunk, _enc, cb) { output += chunk.toString(); cb() } })
  const app = await startApp(dbh.url, OPEN, { logger: { stream } })
  try {
    const u = await phoneUser(app)
    await sleep(1100)
    const code = await resetCode(app, u.phone)
    await reset(app, u.phone, wrongOf(code))
    await reset(app, u.phone, code, `${u.phone}x`)
    assert.equal((await reset(app, u.phone, code)).statusCode, 200)
    // Envoi en échec dans la file : message générique seulement.
    app.app.sms.send = async () => { throw new Error(`échec ${code} ${u.phone}`) }
    await sleep(1100)
    await forgot(app, u.phone)
    await sleep(100)
    assert.ok(output.includes('/api/auth/phone/reset'), 'le journal a bien capturé les requêtes')
    assert.ok(!output.includes(code), 'aucun code dans le journal')
    assert.ok(!output.includes(u.phone.slice(1)) && !output.includes(u.phone.slice(4)), 'aucun numéro dans le journal')
    assert.ok(!output.includes(NEW_PASSWORD), 'aucun mot de passe dans le journal')
  } finally { await app.close() }
})

test('aucun fournisseur SMS (production) → 503 avant toute lecture ni budget', async () => {
  const off = await startApp(dbh.url, { ...OPEN, SMS_PROVIDER: 'none' })
  try {
    const phone = newPhone()
    for (const r of [await forgot(off, phone), await reset(off, phone, '123456')]) {
      assert.equal(r.statusCode, 503)
      assert.equal(r.json().code, 'sms_unavailable')
    }
    assert.equal((await off.db.query('SELECT count(*)::int AS n FROM phone_send_limits WHERE phone = $1', [phone])).rows[0].n, 0, 'aucun budget pris')
  } finally { await off.close() }
})

test('SMS de réinitialisation : un seul message GSM 7 bits, trois langues, sans donnée du compte', () => {
  const t = smsTexts('Akaiky')
  const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇØøÅå_ÆæßÉ!"#%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n]*$/
  for (const lang of ['mg', 'fr', 'en']) {
    for (const s of [t.reset('123456', lang), t.passwordChanged(lang)]) {
      assert.ok(s.length <= 160, `${lang} : ${s.length} caractères`)
      assert.match(s, GSM, s)
    }
    assert.ok(t.reset('123456', lang).includes('123456'))
    assert.doesNotMatch(t.passwordChanged(lang), /\d/)
  }
  assert.equal(t.reset('123456', 'xx'), t.reset('123456', 'mg'), 'malgache par défaut')
})
