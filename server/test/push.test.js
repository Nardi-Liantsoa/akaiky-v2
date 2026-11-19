import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'
import { loadConfig } from '../src/config.js'
import { runRetention } from '../src/jobs.js'
import {
  MAX_ATTEMPTS, PER_OWNER_PER_HOUR, RETRY_AFTER_MAX_S, classifyFcm, createFakeProvider, createFcmProvider, fcmRequestBody, fcmSendUrl,
  loadServiceAccount, notifyDevice, notifyFamily, notifySession, parseRetryAfter, runPushWorker, signJwt, tokenIndex
} from '../src/push.js'
import { MAX_PAYLOAD_BYTES, buildPayload } from '../src/push-texts.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx, fake
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })
// Chaque test a sa file et son fournisseur : le worker ne voit que ce que le test a mis.
beforeEach(async () => { await ctx.db.query('DELETE FROM push_outbox'); fake = createFakeProvider() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const silent = { info() {}, warn() {}, error() {} }
const work = (provider = fake, opts) => runPushWorker(ctx.db, provider, ctx.app.config, silent, opts)
const fcmToken = () => `fcm-${randomUUID()}:APA91b${'x'.repeat(100)}`
const putToken = (u, token, extra = {}) => call(ctx.app, 'PUT', '/api/push/token', { cookie: u.cookie, body: { token, platform: 'android', lang: 'fr', ...extra } })
const putNative = (accessToken, token, extra = {}) => native(ctx.app, 'PUT', '/api/push/token', { token: accessToken, body: { token, platform: 'ios', lang: 'en', ...extra } })
const rowOf = async (token) => (await ctx.db.query('SELECT id, session_id, device_id FROM push_tokens WHERE token_index = $1', [tokenIndex(ctx.app.config, token)])).rows[0]
const sentTo = (token) => fake.sent.filter((s) => s.token === token)
const outbox = async () => (await ctx.db.query('SELECT * FROM push_outbox ORDER BY created_at')).rows
const due = () => ctx.db.query("UPDATE push_outbox SET next_attempt_at = now() WHERE status = 'pending'")
const hasToken = async (token) => Boolean(await rowOf(token))

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function familyWithChild(firstName = 'Fy') {
  const owner = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a' } })
  assert.equal(res.statusCode, 201, res.body)
  return { owner, kid, device: res.json() }
}
const sendMessage = (device, id = randomUUID(), slot = 1) =>
  native(ctx.app, 'POST', '/api/device/messages', { token: device.accessToken, body: { id, slot, sentAt: new Date().toISOString() } })
const nativeLogin = async (u) => (await native(ctx.app, 'POST', '/api/auth/native/login', { body: { email: u.email, password: u.password } })).json()

test('enregistrement : le propriétaire est la session ; aucun champ ne vise un autre compte ; chiffré au repos', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  const token = fcmToken()
  for (const extra of [{ userId: b.id }, { sessionId: randomUUID() }, { deviceId: randomUUID() }]) {
    assert.equal((await putToken(a, token, extra)).statusCode, 400, JSON.stringify(extra))
  }
  for (const bad of [{ token: '' }, { token: 'x'.repeat(4097) }, { token: 'a b' }, { platform: 'web' }, { lang: 'de' }]) {
    assert.equal((await putToken(a, token, bad)).statusCode, 400, JSON.stringify(bad))
  }
  assert.equal((await call(ctx.app, 'PUT', '/api/push/token', { body: { token, platform: 'android' } })).statusCode, 401)
  const ok = await putToken(a, token)
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal((await putToken(a, token)).statusCode, 200, 'idempotent')
  const { rows } = await ctx.db.query(
    'SELECT t.token_enc, t.lang, s.user_id FROM push_tokens t JOIN sessions s ON s.id = t.session_id WHERE s.user_id = $1', [a.id])
  assert.equal(rows.length, 1, 'jamais dupliqué')
  assert.equal(rows[0].user_id, a.id)
  assert.ok(!rows[0].token_enc.includes(Buffer.from(token)), 'jeton chiffré')
  // Un jeton rafraîchi remplace le précédent de la même session.
  const renewed = fcmToken()
  await putToken(a, renewed, { lang: 'mg' })
  assert.equal(await hasToken(token), false)
  assert.equal(await hasToken(renewed), true)
})

test('même jeton enregistré par B après A : il n’appartient plus qu’à B ; les notifications de la famille de A n’y vont plus', async () => {
  const { owner: a, device } = await familyWithChild()
  const b = await newUser(ctx)
  const token = fcmToken()
  await putToken(a, token)
  await sendMessage(device)
  assert.equal((await outbox()).length, 1)
  assert.equal((await putToken(b, token)).statusCode, 200)
  const { rows } = await ctx.db.query('SELECT s.user_id FROM push_tokens t JOIN sessions s ON s.id = t.session_id WHERE t.token_index = $1',
    [tokenIndex(ctx.app.config, token)])
  assert.deepEqual(rows.map((r) => r.user_id), [b.id])
  assert.deepEqual((await outbox()).map((r) => [r.token_id, r.owner_key]), [[null, `user:${a.id}`]],
    'la file de A ne vise plus ce jeton (elle reste pour le plafond de A)')
  await sendMessage(device)
  assert.equal((await outbox()).length, 1, 'B n’est pas de la famille')
  await work()
  assert.equal(fake.sent.length, 0)
  assert.deepEqual((await outbox()).map((r) => [r.status, r.last_error]), [['failed', 'token_gone']])
})

test('retrait : seulement le jeton de sa session, sinon 404 et rien ne change', async () => {
  const a = await newUser(ctx), b = await newUser(ctx)
  const token = fcmToken()
  await putToken(a, token)
  const other = await call(ctx.app, 'DELETE', '/api/push/token', { cookie: b.cookie, body: { token } })
  assert.equal(other.statusCode, 404)
  assert.equal(await hasToken(token), true)
  assert.equal((await call(ctx.app, 'DELETE', '/api/push/token', { cookie: a.cookie, body: { token, userId: b.id } })).statusCode, 400)
  assert.equal((await call(ctx.app, 'DELETE', '/api/push/token', { cookie: a.cookie, body: { token } })).statusCode, 200)
  assert.equal(await hasToken(token), false)
  assert.equal((await call(ctx.app, 'DELETE', '/api/push/token', { cookie: a.cookie, body: { token } })).statusCode, 404)
})

test('déconnexion (web et app), révocation de session, réinitialisation du mot de passe : jeton supprimé, plus de push', async () => {
  const { owner, device } = await familyWithChild()
  // Web : déconnexion par cookie.
  const web = fcmToken()
  await putToken(owner, web)
  assert.equal((await call(ctx.app, 'POST', '/api/auth/logout', { cookie: owner.cookie })).statusCode, 200)
  assert.equal(await hasToken(web), false)
  // App : déconnexion native.
  const s1 = await nativeLogin(owner), t1 = fcmToken()
  assert.equal((await putNative(s1.accessToken, t1)).statusCode, 200)
  await native(ctx.app, 'POST', '/api/auth/native/logout', { body: { refreshToken: s1.refreshToken } })
  assert.equal(await hasToken(t1), false)
  // App : session révoquée depuis l'espace sécurité (autre session du compte).
  const s2 = await nativeLogin(owner), t2 = fcmToken()
  await putNative(s2.accessToken, t2)
  const s3 = await nativeLogin(owner)
  const list = (await native(ctx.app, 'GET', '/api/auth/app-sessions', { token: s3.accessToken })).json()
  const s2row = await rowOf(t2)
  assert.ok(list.some((s) => s.id === s2row.session_id && !s.current))
  assert.equal((await native(ctx.app, 'DELETE', `/api/auth/app-sessions/${s2row.session_id}`, { token: s3.accessToken })).statusCode, 200)
  assert.equal(await hasToken(t2), false)
  // Réinitialisation du mot de passe : toutes les sessions tombent, leurs jetons avec.
  const t3 = fcmToken()
  await putNative(s3.accessToken, t3)
  await call(ctx.app, 'POST', '/api/auth/forgot-password', { body: { email: owner.email } })
  let mail
  for (let i = 0; i < 50 && !mail; i++) { mail = ctx.sent.findLast((m) => m.to === owner.email && m.text.includes('#reset=')); if (!mail) await new Promise((r) => setTimeout(r, 50)) }
  const reset = await call(ctx.app, 'POST', '/api/auth/reset-password', { body: { token: tokenIn(mail, 'reset'), password: 'un tout nouveau mot de passe' } })
  assert.equal(reset.statusCode, 200, reset.body)
  assert.equal(await hasToken(t3), false)
  await sendMessage(device)
  await work()
  assert.equal(fake.sent.length, 0)
})

test('téléphone de l’enfant : enregistre et retire son jeton ; révoqué, son jeton disparaît', async () => {
  const { owner, device } = await familyWithChild()
  const token = fcmToken()
  const put = (body) => native(ctx.app, 'PUT', '/api/device/push/token', { token: device.accessToken, body })
  assert.equal((await put({ token, platform: 'ios' })).statusCode, 400, 'Android seulement')
  assert.equal((await put({ token, platform: 'android', familyId: randomUUID() })).statusCode, 400)
  assert.equal((await native(ctx.app, 'PUT', '/api/device/push/token', { body: { token, platform: 'android' } })).statusCode, 401)
  assert.equal((await call(ctx.app, 'PUT', '/api/device/push/token', { cookie: owner.cookie, body: { token, platform: 'android' } })).statusCode, 403)
  assert.equal((await put({ token, platform: 'android', lang: 'mg' })).statusCode, 200)
  const { rows: [row] } = await ctx.db.query('SELECT device_id, family_id, session_id FROM push_tokens WHERE device_id = $1', [device.device.id])
  assert.equal(row.session_id, null)
  assert.ok(row.family_id)
  assert.equal((await native(ctx.app, 'DELETE', '/api/device/push/token', { token: device.accessToken, body: { token } })).statusCode, 200)
  assert.equal(await hasToken(token), false)
  await put({ token, platform: 'android' })
  // Le parent ne retire pas le jeton du téléphone par sa route : 404.
  assert.equal((await call(ctx.app, 'DELETE', '/api/push/token', { cookie: owner.cookie, body: { token } })).statusCode, 404)
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 200)
  assert.equal(await hasToken(token), false)
})

test('message rapide : une notification par jeton des membres, prénom sans texte, data = { type, id } ; rejeu sans second push', async () => {
  const { owner, kid, device } = await familyWithChild('Fy')
  const manager = await join(owner, 'manager')
  const outsider = await newUser(ctx)
  // Texte personnalisé de l'emplacement 2 : il ne doit jamais partir dans une notification.
  assert.equal((await call(ctx.app, 'PUT', `/api/children/${kid.id}/message-templates/2`, { cookie: owner.cookie, body: { text: 'Viens me chercher' } })).statusCode, 200)
  const tOwner = fcmToken(), tManager = fcmToken(), tOutsider = fcmToken()
  await putToken(owner, tOwner, { lang: 'fr' })
  const nat = await nativeLogin(manager)
  await putNative(nat.accessToken, tManager, { lang: 'en' })
  await putToken(outsider, tOutsider)

  const id = randomUUID()
  assert.equal((await sendMessage(device, id, 2)).statusCode, 200)
  assert.equal((await sendMessage(device, id, 2)).statusCode, 200, 'rejeu')
  assert.equal((await outbox()).length, 2, 'un par membre, rejeu ignoré')
  const summary = await work()
  assert.equal(summary.sent, 2)
  assert.equal(sentTo(tOutsider).length, 0)
  const [fr] = sentTo(tOwner), [en] = sentTo(tManager)
  assert.equal(fr.message.notification.title, 'Fy a envoyé un message')
  assert.equal(en.message.notification.title, 'Fy sent a message')
  for (const s of [fr, en]) {
    const json = JSON.stringify(s.message)
    assert.ok(!json.includes('Viens') && !json.includes('chercher') && !/"slot"/.test(json), json)
    assert.deepEqual(s.message.data, { type: 'message', id })
    assert.equal(s.message.android.notification.channel_id, 'alertes')
    assert.equal(s.message.android.priority, 'high')
    assert.ok(Buffer.byteLength(JSON.stringify(fcmRequestBody(s.token, s.message))) < MAX_PAYLOAD_BYTES)
  }
  assert.deepEqual((await outbox()).map((r) => [r.status, r.attempts, r.last_error]), [['sent', 1, null], ['sent', 1, null]])
  // Rejeu plus tard (file hors ligne) : rien de nouveau.
  await sendMessage(device, id, 2)
  assert.equal((await outbox()).length, 2)
  await work()
  assert.equal(fake.sent.length, 2)
})

test('membre parti avant l’envoi : rien ne part vers lui', async () => {
  const { owner, device } = await familyWithChild()
  const member = await join(owner, 'member')
  const token = fcmToken()
  await putToken(member, token)
  await sendMessage(device)
  assert.equal((await call(ctx.app, 'DELETE', `/api/families/me/members/${member.id}`, { cookie: member.cookie })).statusCode, 200)
  await work()
  assert.equal(fake.sent.length, 0)
  assert.equal((await outbox())[0].last_error, 'not_member')
})

test('worker : UNREGISTERED supprime le jeton ; INVALID_ARGUMENT sur la charge utile ne le supprime pas', async () => {
  const u = await newUser(ctx), dead = fcmToken()
  await putToken(u, dead)
  await notifySession(ctx.db, (await rowOf(dead)).session_id, 'test')
  fake.failNext('unregistered')
  assert.equal((await work()).removedTokens, 1)
  assert.equal(await hasToken(dead), false)
  assert.deepEqual((await outbox()).map((r) => [r.status, r.token_id, r.last_error]), [['failed', null, 'fake unregistered']])
  await ctx.db.query('DELETE FROM push_outbox')

  const kept = fcmToken()
  await putToken(u, kept)
  const sid2 = (await rowOf(kept)).session_id
  await notifySession(ctx.db, sid2, 'test')
  fake.failNext('fail')
  await work()
  assert.equal(await hasToken(kept), true)
  assert.deepEqual((await outbox()).map((r) => r.status), ['failed'])
})

test('worker : SENDER_ID_MISMATCH, 404 sans UNREGISTERED, 401/403 gardent le jeton ; nouvelle tentative, alarme une fois par tour sans jeton', async () => {
  const sa = loadServiceAccount(SA_JSON)
  const u = await newUser(ctx), a = fcmToken()
  await putToken(u, a)
  const nat = await nativeLogin(u), b = fcmToken()
  await putNative(nat.accessToken, b)
  const responses = [
    { status: 403, body: { error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } } },
    { status: 404, body: { error: { status: 'NOT_FOUND', message: `Requested entity was not found. ${a}` } } }
  ]
  let i = 0
  const fetch = async (url) => {
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3599 }), { status: 200 })
    const r = responses[i++ % responses.length]
    return new Response(JSON.stringify(r.body), { status: r.status })
  }
  const fcm = createFcmProvider(sa, { fetch })
  const logs = []
  const log = { info: (o, m) => logs.push(['info', o, m]), warn: (o, m) => logs.push(['warn', o, m]), error: (o, m) => logs.push(['error', o, m]) }
  await notifySession(ctx.db, (await rowOf(a)).session_id, 'test')
  await notifySession(ctx.db, (await rowOf(b)).session_id, 'test')
  const summary = await runPushWorker(ctx.db, fcm, ctx.app.config, log, { concurrency: 1 })
  assert.deepEqual([summary.retried, summary.removedTokens], [2, 0])
  assert.equal(await hasToken(a), true)
  assert.equal(await hasToken(b), true)
  assert.deepEqual((await outbox()).map((r) => r.status), ['pending', 'pending'])
  assert.equal(logs.filter(([level]) => level === 'error').length, 1, 'une alarme par tour')
  const text = JSON.stringify(logs)
  assert.ok(!text.includes(a) && !text.includes(b), 'aucun jeton dans les journaux')
  assert.match(text, /configuration FCM/)
  // Après MAX_ATTEMPTS : abandon, jeton toujours là.
  for (let n = 1; n < MAX_ATTEMPTS; n++) { await due(); await runPushWorker(ctx.db, fcm, ctx.app.config, log) }
  assert.deepEqual((await outbox()).map((r) => r.status), ['failed', 'failed'])
  assert.equal(await hasToken(a), true)
  assert.equal(await hasToken(b), true)
})

test('worker : jeton mort pendant un tour → ses autres lignes sautées, compté une fois', async () => {
  const u = await newUser(ctx), token = fcmToken()
  await putToken(u, token)
  const tokenId = (await rowOf(token)).id
  await ctx.db.query("INSERT INTO push_outbox(token_id, owner_key, kind, event) SELECT $1, $2, 'notification', 'test' FROM generate_series(1, 4)", [tokenId, `user:${u.id}`])
  fake.failNext('unregistered')
  const sequential = await work(fake, { concurrency: 1 })
  assert.equal(sequential.removedTokens, 1)
  assert.equal(fake.sent.length, 0, 'rien ne part vers un jeton supprimé dans le même tour')
  assert.ok((await outbox()).every((r) => r.status === 'failed' && r.token_id === null), 'lignes abandonnées, pas laissées en attente')
  // En parallèle : plusieurs réponses UNREGISTERED pour le même jeton, une seule suppression comptée.
  const again = fcmToken()
  await putToken(u, again)
  await ctx.db.query("INSERT INTO push_outbox(token_id, owner_key, kind, event) SELECT $1, $2, 'notification', 'test' FROM generate_series(1, 4)", [(await rowOf(again)).id, `user:${u.id}`])
  fake.failNext('unregistered', 'unregistered', 'unregistered', 'unregistered')
  assert.equal((await work(fake, { concurrency: 4 })).removedTokens, 1)
  assert.equal(await hasToken(again), false)
})

test('worker : erreur temporaire → nouvelle tentative comptée en base, puis succès ; 5 échecs → abandon', async () => {
  const u = await newUser(ctx), token = fcmToken()
  await putToken(u, token)
  const sid = (await rowOf(token)).session_id
  await notifySession(ctx.db, sid, 'test')
  fake.failNext('retry')
  assert.equal((await work()).retried, 1)
  let [row] = await outbox()
  assert.equal(row.status, 'pending')
  assert.equal(row.attempts, 1)
  assert.equal(row.last_error, 'fake retry')
  assert.ok(row.next_attempt_at > new Date(Date.now() + 20_000), 'pas avant 30 s')
  assert.equal((await work()).claimed, 0, 'pas encore dû')
  await due()
  assert.equal((await work()).sent, 1)
  ;[row] = await outbox()
  assert.deepEqual([row.status, row.attempts, row.last_error], ['sent', 2, null])
  assert.ok(row.sent_at)

  await ctx.db.query('DELETE FROM push_outbox')
  await notifySession(ctx.db, sid, 'test')
  fake.failNext(...Array(MAX_ATTEMPTS).fill('retry'))
  const delays = []
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await work()
    ;[row] = await outbox()
    if (row.status === 'pending') delays.push(Math.round((row.next_attempt_at - Date.now()) / 1000))
    await due()
  }
  assert.deepEqual([row.status, row.attempts, row.last_error], ['failed', MAX_ATTEMPTS, 'fake retry'])
  assert.equal(delays.length, MAX_ATTEMPTS - 1)
  for (const [i, d] of delays.entries()) assert.ok(Math.abs(d - 30 * 2 ** i) <= 2, `délai ${i} : ${d}`)
  assert.equal((await work()).claimed, 0)
  assert.equal(fake.sent.length, 1)
})

test('worker : deux instances simultanées n’envoient chaque ligne qu’une fois', async () => {
  const u = await newUser(ctx), token = fcmToken()
  await putToken(u, token)
  const tokenId = (await rowOf(token)).id
  await ctx.db.query("INSERT INTO push_outbox(token_id, owner_key, kind, event) SELECT $1, $2, 'notification', 'test' FROM generate_series(1, 24)", [tokenId, `user:${u.id}`])
  const drain = async () => { while ((await work(fake, { batch: 3 })).claimed) { /* tours suivants */ } }
  await Promise.all([drain(), drain(), drain()])
  assert.equal(fake.sent.length, 24)
  const rows = await outbox()
  assert.ok(rows.every((r) => r.status === 'sent' && r.attempts === 1))
})

test('plafond : 30 notifications par heure et par COMPTE, tous ses jetons confondus, même en concurrence', async () => {
  const u = await newUser(ctx), web = fcmToken(), app = fcmToken()
  await putToken(u, web)
  const nat = await nativeLogin(u)
  await putNative(nat.accessToken, app)
  const sid = (await rowOf(web)).session_id
  const sidApp = (await rowOf(app)).session_id
  // Envois simultanés vers les deux sessions du compte : le verrou par compte empêche le dépassement.
  const results = await Promise.all(Array.from({ length: PER_OWNER_PER_HOUR + 10 }, (_, i) => notifySession(ctx.db, i % 2 ? sid : sidApp, 'test')))
  assert.equal(results.reduce((n, r) => n + r.queued, 0), PER_OWNER_PER_HOUR)
  // Un autre compte a son propre plafond.
  const v = await newUser(ctx), other = fcmToken()
  await putToken(v, other)
  assert.equal((await notifySession(ctx.db, (await rowOf(other)).session_id, 'test')).queued, 1)
  // Au-delà d'une heure, le compteur repart.
  await ctx.db.query("UPDATE push_outbox SET created_at = now() - interval '61 minutes'")
  assert.equal((await notifySession(ctx.db, sid, 'test')).queued, 1)
})

test('plafond : se déconnecter puis réenregistrer le même jeton ne remet pas le compteur à zéro', async () => {
  const u = await newUser(ctx), token = fcmToken()
  const s1 = await nativeLogin(u)
  await putNative(s1.accessToken, token)
  const sid = (await rowOf(token)).session_id
  for (let i = 0; i < PER_OWNER_PER_HOUR; i++) assert.equal((await notifySession(ctx.db, sid, 'test')).queued, 1)
  assert.equal((await notifySession(ctx.db, sid, 'test')).queued, 0, 'plafond atteint')
  await native(ctx.app, 'POST', '/api/auth/native/logout', { body: { refreshToken: s1.refreshToken } })
  assert.equal(await hasToken(token), false)
  const rows = await outbox()
  assert.equal(rows.length, PER_OWNER_PER_HOUR, 'la file reste après la déconnexion')
  assert.ok(rows.every((r) => r.token_id === null && r.owner_key === `user:${u.id}`))
  const s2 = await nativeLogin(u)
  assert.equal((await putNative(s2.accessToken, token)).statusCode, 200)
  assert.deepEqual(await notifySession(ctx.db, (await rowOf(token)).session_id, 'test'), { targets: 1, queued: 0 }, 'toujours plafonné')
  // Le worker abandonne les lignes sans jeton, rien ne part.
  const summary = await work()
  assert.deepEqual([summary.sent, summary.failed], [0, PER_OWNER_PER_HOUR])
  assert.equal(fake.sent.length, 0)
})

test('un seul jeton par session : deux enregistrements simultanés de jetons différents → une seule ligne', async () => {
  const u = await newUser(ctx)
  const tokens = Array.from({ length: 6 }, fcmToken)
  const results = await Promise.all(tokens.map((t) => putToken(u, t)))
  assert.ok(results.every((r) => r.statusCode === 200), results.map((r) => r.body).join())
  const { rows } = await ctx.db.query('SELECT t.id FROM push_tokens t JOIN sessions s ON s.id = t.session_id WHERE s.user_id = $1', [u.id])
  assert.equal(rows.length, 1)
  // L'index unique tient même sans le code de l'API.
  const { rows: [row] } = await ctx.db.query('SELECT session_id FROM push_tokens WHERE id = $1', [rows[0].id])
  await assert.rejects(ctx.db.query(
    "INSERT INTO push_tokens(session_id, platform, token_enc, token_index) VALUES ($1, 'android', '\\x00', '\\x01')", [row.session_id]),
  /push_tokens_session/)
})

test('plafond : 30 par heure et par téléphone d’enfant', async () => {
  const { device } = await familyWithChild()
  const token = fcmToken()
  await native(ctx.app, 'PUT', '/api/device/push/token', { token: device.accessToken, body: { token, platform: 'android' } })
  const results = await Promise.all(Array.from({ length: PER_OWNER_PER_HOUR + 5 }, () => notifyDevice(ctx.db, device.device.id, 'config')))
  assert.equal(results.reduce((n, r) => n + r.queued, 0), PER_OWNER_PER_HOUR)
})

test('cibles de la famille : même règle de session que le hook (adresse confirmée, second facteur exigé)', async () => {
  const { owner, device } = await familyWithChild()
  const unverified = await join(owner, 'member'), admin = await join(owner, 'member')
  const tOwner = fcmToken(), tUnverified = fcmToken(), tAdmin = fcmToken()
  await putToken(owner, tOwner)
  await putToken(unverified, tUnverified)
  await putToken(admin, tAdmin)
  await ctx.db.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [unverified.id])
  // Devenu admin, sa session sans second facteur vérifié n'est plus une session.
  await ctx.db.query('UPDATE users SET is_admin = true WHERE id = $1', [admin.id])
  const owners = async () => (await ctx.db.query(
    'SELECT t.token_index FROM push_outbox o JOIN push_tokens t ON t.id = o.token_id')).rows.map((r) => r.token_index.toString('hex'))
  assert.equal((await sendMessage(device)).statusCode, 200)
  assert.deepEqual(await owners(), [tokenIndex(ctx.app.config, tOwner).toString('hex')])
  // Session expirée : exclue aussi.
  await ctx.db.query('UPDATE sessions SET expires_at = now() - interval \'1 minute\', refresh_expires_at = NULL WHERE id = $1', [(await rowOf(tOwner)).session_id])
  await ctx.db.query('DELETE FROM push_outbox')
  const { rows: [m] } = await ctx.db.query('SELECT family_id FROM memberships WHERE user_id = $1', [owner.id])
  assert.deepEqual(await notifyFamily(ctx.db, m.family_id, 'test'), { targets: 0, queued: 0 })
})

test('« vu à » du jeton : une requête authentifiée le rafraîchit (au plus une fois par heure), la purge le garde', async () => {
  const { owner, device } = await familyWithChild()
  const web = fcmToken(), app = fcmToken(), phone = fcmToken(), recent = fcmToken()
  await putToken(owner, web)
  const nat = await nativeLogin(owner)
  await putNative(nat.accessToken, app)
  await native(ctx.app, 'PUT', '/api/device/push/token', { token: device.accessToken, body: { token: phone, platform: 'android' } })
  const other = await newUser(ctx)
  await putToken(other, recent)
  const age = (token, interval) => ctx.db.query(`UPDATE push_tokens SET last_seen_at = now() - interval '${interval}' WHERE token_index = $1`, [tokenIndex(ctx.app.config, token)])
  const seen = async (token) => (await ctx.db.query('SELECT last_seen_at FROM push_tokens WHERE token_index = $1', [tokenIndex(ctx.app.config, token)])).rows[0]?.last_seen_at
  // 59 jours (bientôt purgé) et 61 jours (la purge le supprimerait sans activité).
  await age(app, '59 days')
  for (const t of [web, phone]) await age(t, '61 days')
  await age(recent, '30 minutes')
  const before = await seen(recent)
  // Web (cookie) : GET /api/auth/me ; app (Bearer) : n'importe quelle route ; téléphone : session d'appareil.
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: owner.cookie })).json().user.id, owner.id)
  assert.equal((await native(ctx.app, 'GET', '/api/auth/me', { token: nat.accessToken })).json().user.id, owner.id)
  await sendMessage(device)
  await call(ctx.app, 'GET', '/api/auth/me', { cookie: other.cookie })
  for (const t of [web, app, phone]) assert.ok(Date.now() - (await seen(t)) < 60_000, 'rafraîchi')
  assert.deepEqual(await seen(recent), before, 'vu il y a moins d’une heure : pas réécrit')
  // Purge : les jetons actifs restent.
  await ctx.db.query("UPDATE job_runs SET started_at = NULL WHERE job = 'retention'")
  await runRetention(ctx.db, silent)
  for (const t of [web, app, phone]) assert.equal(await hasToken(t), true)
})

test('notification de test : vers la seule session appelante, 5 par heure', async () => {
  const u = await newUser(ctx)
  const mine = fcmToken(), other = fcmToken()
  await putToken(u, mine, { lang: 'en' })
  const nat = await nativeLogin(u)
  await putNative(nat.accessToken, other)
  const r = await call(ctx.app, 'POST', '/api/push/test', { cookie: u.cookie })
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual(r.json(), { queued: 1 })
  await work()
  assert.equal(sentTo(other).length, 0)
  assert.equal(sentTo(mine)[0].message.notification.title, 'Test notification')
  assert.deepEqual(sentTo(mine)[0].message.data, { type: 'test' })
  for (let i = 0; i < 4; i++) assert.equal((await call(ctx.app, 'POST', '/api/push/test', { cookie: u.cookie })).statusCode, 200)
  assert.equal((await call(ctx.app, 'POST', '/api/push/test', { cookie: u.cookie })).statusCode, 429)
  assert.equal((await call(ctx.app, 'POST', '/api/push/test')).statusCode, 401)
})

test('purge : jeton non vu depuis 61 jours supprimé ; file envoyée ou abandonnée de plus de 7 jours supprimée', async () => {
  const u = await newUser(ctx), old = fcmToken(), fresh = fcmToken()
  await putToken(u, old)
  const nat = await nativeLogin(u)
  await putNative(nat.accessToken, fresh)
  const idx = tokenIndex
  await ctx.db.query("UPDATE push_tokens SET last_seen_at = now() - interval '61 days' WHERE token_index = $1", [idx(ctx.app.config, old)])
  await ctx.db.query("UPDATE push_tokens SET last_seen_at = now() - interval '59 days' WHERE token_index = $1", [idx(ctx.app.config, fresh)])
  const freshId = (await rowOf(fresh)).id
  const { rows } = await ctx.db.query(
    `INSERT INTO push_outbox(token_id, owner_key, kind, event, status, created_at) VALUES
       ($1, $2, 'notification', 'test', 'sent', now() - interval '8 days'),
       ($1, $2, 'notification', 'test', 'failed', now() - interval '8 days'),
       ($1, $2, 'notification', 'test', 'sent', now() - interval '6 days'),
       ($1, $2, 'notification', 'test', 'pending', now() - interval '8 days'),
       (NULL, $2, 'notification', 'test', 'pending', now() - interval '8 days') RETURNING id, status, created_at`, [freshId, `user:${u.id}`])
  await ctx.db.query("UPDATE job_runs SET started_at = NULL WHERE job = 'retention'")
  const result = await runRetention(ctx.db, silent)
  assert.ok(result.pushTokens >= 1 && result.pushOutbox >= 3, JSON.stringify(result))
  assert.equal(await hasToken(old), false)
  assert.equal(await hasToken(fresh), true)
  const left = (await ctx.db.query('SELECT id FROM push_outbox WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)])).rows.map((r) => r.id)
  assert.deepEqual(left.sort(), [rows[2].id, rows[3].id].sort())
})

test('contenu : textes dans la langue du jeton, prénom borné, charge utile sous 4 Ko, réveil silencieux sans notification', () => {
  const id = randomUUID()
  assert.equal(buildPayload({ event: 'message', ref: id, lang: 'mg', name: 'Fy' }).notification.title, 'Nandefa hafatra i Fy')
  assert.equal(buildPayload({ event: 'test', lang: 'fr' }).notification.title, 'Notification de test')
  assert.equal(buildPayload({ event: 'test', lang: 'xx' }).notification.title, 'Fampandrenesana andrana', 'malgache par défaut')
  const long = buildPayload({ event: 'message', ref: id, lang: 'fr', name: 'É'.repeat(500) + '\n' })
  assert.ok([...long.notification.title].length < 70)
  assert.ok(Buffer.byteLength(JSON.stringify(fcmRequestBody('t'.repeat(1000), long))) < MAX_PAYLOAD_BYTES)
  const wake = buildPayload({ event: 'config', lang: 'mg' })
  assert.equal(wake.notification, undefined)
  assert.deepEqual(wake.data, { type: 'config' })
  assert.equal(wake.apns.payload.aps['content-available'], 1)
  assert.throws(() => buildPayload({ event: 'autre', lang: 'fr' }), /inconnu/)
})

// ---------------------------------------------------------------- FCM sans réseau

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const SA_JSON = JSON.stringify({
  type: 'service_account', project_id: 'akaiky-test-1234', client_email: 'push@akaiky-test-1234.iam.gserviceaccount.com',
  private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token'
})

test('FCM : JWT RS256 du compte de service (revendications, signature) et message HTTP v1', () => {
  const sa = loadServiceAccount(SA_JSON)
  const jwt = signJwt(sa, 1_800_000_000)
  const [h, c, s] = jwt.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' })
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), {
    iss: 'push@akaiky-test-1234.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600
  })
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), keys.publicKey, Buffer.from(s, 'base64url')))
  assert.equal(fcmSendUrl(sa), 'https://fcm.googleapis.com/v1/projects/akaiky-test-1234/messages:send')
  const body = fcmRequestBody('TOKEN', buildPayload({ event: 'test', lang: 'fr' }))
  assert.equal(body.message.token, 'TOKEN')
  assert.equal(body.message.apns.headers['apns-push-type'], 'alert')
})

test('FCM : jeton d’accès échangé une fois puis réutilisé ; réponses classées', async () => {
  const sa = loadServiceAccount(SA_JSON)
  const calls = []
  let next = { status: 200, body: { name: 'projects/x/messages/1' } }
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3599 }), { status: 200 })
    if (next === 'network') throw new TypeError('fetch failed')
    return new Response(JSON.stringify(next.body), { status: next.status })
  }
  const fcm = createFcmProvider(sa, { fetch })
  const message = buildPayload({ event: 'test', lang: 'en' })
  assert.deepEqual(await fcm.send('T1', message), { ok: true })
  assert.deepEqual(await fcm.send('T2', message), { ok: true })
  assert.equal(calls.filter((x) => x.url.includes('oauth2')).length, 1, 'jeton d’accès mis en cache')
  const form = new URLSearchParams(calls[0].init.body)
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  assert.equal(form.get('assertion').split('.').length, 3)
  const send = calls[1]
  assert.equal(send.url, fcmSendUrl(sa))
  assert.equal(send.init.headers.authorization, 'Bearer ya29.test')
  assert.equal(JSON.parse(send.init.body).message.token, 'T1')

  next = { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } } }
  assert.equal((await fcm.send('T', message)).outcome, 'unregistered')
  next = 'network'
  assert.equal((await fcm.send('T', message)).outcome, 'retry')
  assert.equal(classifyFcm(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }).outcome, 'invalid_token')
  assert.equal(classifyFcm(400, { error: { status: 'INVALID_ARGUMENT', details: [{ fieldViolations: [{ field: 'message.token' }] }] } }).outcome, 'invalid_token')
  assert.equal(classifyFcm(400, { error: { status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload' } }).outcome, 'fail')
  // Défauts de configuration : jamais une suppression du jeton.
  for (const [status, body] of [
    [403, { error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }],
    [404, { error: { status: 'NOT_FOUND' } }],
    [404, null],
    [401, { error: { status: 'UNAUTHENTICATED' } }],
    [403, { error: { status: 'PERMISSION_DENIED' } }]
  ]) assert.deepEqual([classifyFcm(status, body).outcome, classifyFcm(status, body).config], ['retry', true], `${status}`)
  assert.equal(classifyFcm(400, { error: { status: 'INVALID_ARGUMENT', details: [{ fieldViolations: [{ field: 'message.android', description: 'Invalid registration token' }] }] } }).outcome, 'invalid_token')
  for (const status of [429, 500, 503]) assert.equal(classifyFcm(status, null).outcome, 'retry')
  const unregistered = classifyFcm(404, { error: { message: 'Requested entity was not found. token=SECRET', details: [{ errorCode: 'UNREGISTERED' }] } })
  assert.equal(unregistered.outcome, 'unregistered')
  assert.ok(!unregistered.error.includes('SECRET'), 'le message d’erreur (qui peut citer le jeton) n’est pas gardé')
})

test('FCM : demandes de jeton d’accès simultanées partagées ; échec oublié, la suivante redemande', async () => {
  const sa = loadServiceAccount(SA_JSON)
  let oauth = 0, failOauth = true
  const fetch = async (url) => {
    if (url.includes('oauth2')) {
      oauth++
      await new Promise((r) => setTimeout(r, 20))
      return failOauth ? new Response('{}', { status: 400 }) : new Response(JSON.stringify({ access_token: 'ya29.ok', expires_in: 3599 }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }
  const fcm = createFcmProvider(sa, { fetch })
  const message = buildPayload({ event: 'test', lang: 'en' })
  const failed = await Promise.all([fcm.send('A', message), fcm.send('B', message), fcm.send('C', message)])
  assert.equal(oauth, 1, 'une seule demande pour trois envois simultanés')
  assert.ok(failed.every((r) => r.outcome === 'retry' && r.config))
  failOauth = false
  const ok = await Promise.all([fcm.send('A', message), fcm.send('B', message)])
  assert.equal(oauth, 2, 'l’échec n’est pas gardé en cache')
  assert.ok(ok.every((r) => r.ok))
  await fcm.send('C', message)
  assert.equal(oauth, 2)
})

test('FCM : 401 UNAUTHENTICATED oublie le jeton d’accès ; THIRD_PARTY_AUTH_ERROR le garde (configuration, alarme)', async () => {
  const sa = loadServiceAccount(SA_JSON)
  let oauth = 0, next
  const fetch = async (url) => {
    if (url.includes('oauth2')) { oauth++; return new Response(JSON.stringify({ access_token: `ya29.${oauth}`, expires_in: 3599 }), { status: 200 }) }
    return new Response(JSON.stringify(next), { status: next ? 401 : 200 })
  }
  const fcm = createFcmProvider(sa, { fetch })
  const message = buildPayload({ event: 'test', lang: 'en' })
  next = { error: { status: 'UNAUTHENTICATED', details: [{ errorCode: 'THIRD_PARTY_AUTH_ERROR' }] } }
  const third = await fcm.send('T', message)
  assert.deepEqual([third.outcome, third.config, third.auth], ['retry', true, false])
  next = null
  assert.ok((await fcm.send('T', message)).ok)
  assert.equal(oauth, 1, 'THIRD_PARTY_AUTH_ERROR : jeton d’accès gardé')
  next = { error: { status: 'UNAUTHENTICATED' } }
  const expired = await fcm.send('T', message)
  assert.deepEqual([expired.outcome, expired.config, expired.auth], ['retry', true, true])
  next = null
  assert.ok((await fcm.send('T', message)).ok)
  assert.equal(oauth, 2, 'UNAUTHENTICATED : jeton d’accès redemandé')
  assert.equal(classifyFcm(401, { error: { details: [{ errorCode: 'THIRD_PARTY_AUTH_ERROR' }] } }).auth, false)

  // Par le worker : nouvelle tentative et alarme, jeton gardé.
  const u = await newUser(ctx), token = fcmToken()
  await putToken(u, token)
  await notifySession(ctx.db, (await rowOf(token)).session_id, 'test')
  next = { error: { status: 'UNAUTHENTICATED', details: [{ errorCode: 'THIRD_PARTY_AUTH_ERROR' }] } }
  const errors = []
  const log = { info() {}, warn() {}, error: (o, m) => errors.push(m) }
  assert.equal((await runPushWorker(ctx.db, fcm, ctx.app.config, log)).retried, 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /configuration FCM/)
  assert.equal(oauth, 2)
  assert.equal(await hasToken(token), true)
})

test('FCM : Retry-After sur 429/503 → prochaine tentative au plus tard des deux (borné à 1 h)', async () => {
  const now = Date.parse('2026-11-19T10:00:00Z')
  assert.equal(parseRetryAfter('120', now), 120)
  assert.equal(parseRetryAfter('Thu, 19 Nov 2026 10:05:00 GMT', now), 300)
  assert.equal(parseRetryAfter('n’importe quoi', now), null)
  assert.equal(classifyFcm(429, null, { retryAfter: '600' }).retryAfterS, 600)
  assert.equal(classifyFcm(503, null, { retryAfter: '600' }).retryAfterS, 600)
  assert.equal(classifyFcm(500, null, { retryAfter: '600' }).retryAfterS, undefined)

  const sa = loadServiceAccount(SA_JSON)
  let status = 429, retryAfter = '600'
  const fetch = async (url) => {
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3599 }), { status: 200 })
    return new Response('{}', { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
  }
  const fcm = createFcmProvider(sa, { fetch })
  const u = await newUser(ctx), token = fcmToken()
  await putToken(u, token)
  const sid = (await rowOf(token)).session_id
  const delay = async () => { const [row] = await outbox(); return Math.round((row.next_attempt_at - Date.now()) / 1000) }
  const near = (got, want) => assert.ok(Math.abs(got - want) <= 2, `${got} ≠ ${want}`)
  await notifySession(ctx.db, sid, 'test')
  assert.equal((await work(fcm)).retried, 1)
  near(await delay(), 600)
  // 503, Retry-After au-delà d'une heure : borné.
  status = 503; retryAfter = '86400'
  await due()
  await work(fcm)
  near(await delay(), RETRY_AFTER_MAX_S)
  // Retry-After plus court que la temporisation (3e tentative : 120 s) : la temporisation gagne.
  status = 429; retryAfter = '5'
  await due()
  await work(fcm)
  near(await delay(), 120)
  // Par le fournisseur factice aussi.
  await ctx.db.query('DELETE FROM push_outbox')
  await notifySession(ctx.db, sid, 'test')
  fake.failNext({ outcome: 'retry', retryAfterS: 900 })
  await work()
  near(await delay(), 900)
})

test('configuration : fake refusé en production, choix explicite exigé ; fcm exige un compte de service valable hors du dépôt', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_ORIGIN: 'https://app.test', MFA_ENCRYPTION_KEY: 'ab'.repeat(32), DATA_ENCRYPTION_KEY: 'cd'.repeat(32), TRUST_PROXY: '10.0.0.0/8' }
  assert.throws(() => loadConfig(prod), /PUSH_PROVIDER requis/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fake' }), /interdit en production/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'onesignal' }), /PUSH_PROVIDER/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fcm' }), /FCM_SERVICE_ACCOUNT requis/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: '{"type":"service_account"}' }), /project_id/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: JSON.stringify({ ...JSON.parse(SA_JSON), private_key: 'x' }) }), /private_key/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: JSON.stringify({ ...JSON.parse(SA_JSON), token_uri: 'https://evil.example/token' }) }), /token_uri/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: new URL('../../package.json', import.meta.url).pathname }), /hors du dépôt/)
  assert.throws(() => loadConfig({ ...prod, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: 'relatif.json' }), /absolu/)
  const fcm = loadConfig({ ...prod, PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT: SA_JSON })
  assert.equal(fcm.push.serviceAccount.projectId, 'akaiky-test-1234')
  assert.equal(loadConfig({ ...prod, PUSH_PROVIDER: 'none' }).push.provider, 'none')
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x' }).push.provider, 'fake', 'fake par défaut hors production')
})
