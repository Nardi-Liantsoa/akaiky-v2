// État réel du verrou du téléphone et reverrouillage à distance (NAR-216).
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const family = (u) => call(ctx.app, 'POST', '/api/families', { cookie: u.cookie, body: { name: 'Famille' } })
const child = async (u, firstName = 'Fy') => (await call(ctx.app, 'POST', '/api/children', { cookie: u.cookie, body: { parentalConsent: true, firstName } })).json()
const setCode = (u, id) => call(ctx.app, 'PUT', `/api/children/${id}/parent-code`, { cookie: u.cookie, body: { code: '482915' } })
const unlock = (u, id) => call(ctx.app, 'POST', `/api/children/${id}/unlock`, { cookie: u.cookie })
const relock = (u, id, body) => call(ctx.app, 'DELETE', `/api/children/${id}/unlock`, { cookie: u.cookie, ...(body ? { body } : {}) })
const report = (device, body) => native(ctx.app, 'PUT', '/api/device/lock', { token: device.accessToken, body })
const config = (device, etag) => native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })
const kidOf = async (u, id) => (await call(ctx.app, 'GET', '/api/children', { cookie: u.cookie })).json().find((k) => k.id === id)
const pushToken = (device, token) => native(ctx.app, 'PUT', '/api/device/push/token', { token: device.accessToken, body: { token, platform: 'android', lang: 'fr' } })

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pairedChild(owner, firstName) {
  const kid = await child(owner, firstName)
  assert.equal((await setCode(owner, kid.id)).statusCode, 200)
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a', osVersion: '14', appVersion: '1.0' } })
  assert.equal(res.statusCode, 201, res.body)
  return { kid, device: res.json() }
}

test('rapport du téléphone : sortie par le code montrée aux membres, à l’heure du serveur ; verrouillé l’efface', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await kidOf(owner, fy.kid.id)).phoneUnlock, null)

  const t0 = Date.now()
  const res = await report(fy.device, { remainingS: 600, openedAgoS: 300, source: 'code' })
  assert.equal(res.statusCode, 200, res.body)
  const started = Date.parse(res.json().unlockStartedAt)
  assert.ok(Math.abs(started - (t0 - 300_000)) < 5_000, 'ouverture = maintenant − openedAgoS (heure du serveur)')
  // Un contact voit l'état aussi (il ne peut rien y changer).
  const seen = (await kidOf(member, fy.kid.id)).phoneUnlock
  assert.equal(seen.source, 'code')
  assert.ok(Math.abs(Date.parse(seen.until) - (t0 + 600_000)) < 5_000)
  assert.equal(Date.parse(seen.startedAt), started)

  // Échéance passée sans rapport (téléphone éteint) : plus montrée.
  await ctx.db.query("UPDATE child_devices SET unlocked_until = now() - interval '1 second' WHERE id = $1", [fy.device.device.id])
  assert.equal((await kidOf(owner, fy.kid.id)).phoneUnlock, null)

  assert.equal((await report(fy.device, { remainingS: 120, openedAgoS: 780, source: 'code' })).statusCode, 200)
  const locked = await report(fy.device, { remainingS: 0 })
  assert.equal(locked.statusCode, 200)
  assert.equal(locked.json().unlockStartedAt, null)
  assert.equal((await kidOf(owner, fy.kid.id)).phoneUnlock, null)
})

test('rapport du téléphone : borné à 15 minutes, champs inconnus et combinaisons incohérentes refusés', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  const bad = [
    { remainingS: 901, openedAgoS: 0, source: 'code' },
    { remainingS: 60, openedAgoS: 901, source: 'code' },
    { remainingS: -1 },
    { remainingS: 60, openedAgoS: 0, source: 'admin' },
    { remainingS: 60, openedAgoS: 0 },
    { remainingS: 60, source: 'code' },
    { remainingS: 0, source: 'code' },
    { remainingS: 0, openedAgoS: 10 },
    // Le téléphone ne nomme jamais un autre appareil ni un autre enfant : la session fait foi.
    { remainingS: 60, openedAgoS: 0, source: 'code', deviceId: randomUUID() },
    { remainingS: 0, childId: randomUUID() },
    { remainingS: 60.5, openedAgoS: 0, source: 'code' }
  ]
  for (const body of bad) assert.equal((await report(fy.device, body)).statusCode, 400, JSON.stringify(body))
  // Session de compte : jamais sur les routes du téléphone.
  assert.ok([401, 403].includes((await call(ctx.app, 'PUT', '/api/device/lock', { cookie: owner.cookie, body: { remainingS: 0 } })).statusCode))
})

test('rapport du téléphone : n’écrit que sa ligne, jamais l’enfant d’une autre famille ; téléphone révoqué refusé', async () => {
  const a = await newUser(ctx)
  await family(a)
  const b = await newUser(ctx)
  await family(b)
  const fy = await pairedChild(a, 'Fy')
  const koto = await pairedChild(b, 'Koto')
  assert.equal((await report(fy.device, { remainingS: 300, openedAgoS: 0, source: 'code' })).statusCode, 200)
  assert.notEqual((await kidOf(a, fy.kid.id)).phoneUnlock, null)
  assert.equal((await kidOf(b, koto.kid.id)).phoneUnlock, null, 'l’autre famille n’est pas touchée')

  assert.equal((await call(ctx.app, 'POST', `/api/devices/${fy.device.device.id}/revoke`, { cookie: a.cookie })).statusCode, 200)
  assert.equal((await report(fy.device, { remainingS: 0 })).statusCode, 401)
  assert.equal((await kidOf(a, fy.kid.id)).phoneUnlock, null, 'un téléphone révoqué n’est plus montré')
})

test('reverrouillage : demande écrite, auditée, config invalidée, téléphone réveillé ; rien d’ouvert = aucune écriture', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const manager = await join(owner, 'manager')
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await pushToken(fy.device, 'fcm-' + randomUUID())).statusCode, 200)

  // Rien d'ouvert : 200, aucune écriture, aucun audit, aucun réveil.
  const idle = await relock(manager, fy.kid.id)
  assert.equal(idle.statusCode, 200, idle.body)
  assert.equal(idle.json().relockRequestedAt, null)
  assert.equal((await ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'remote_relock'")).rows.length, 0)

  const opened = (await report(fy.device, { remainingS: 840, openedAgoS: 60, source: 'code' })).json().unlockStartedAt
  const before = await config(fy.device)
  assert.equal(before.json().relockRequestedAt, null)
  const res = await relock(manager, fy.kid.id)
  assert.equal(res.statusCode, 200, res.body)
  const at = res.json().relockRequestedAt
  assert.ok(Date.parse(at) > Date.parse(opened), 'demandé après l’ouverture (même horloge)')
  const after = await config(fy.device, before.headers.etag)
  assert.equal(after.statusCode, 200, 'la demande invalide le 304')
  assert.equal(after.json().relockRequestedAt, at)
  assert.equal((await kidOf(owner, fy.kid.id)).relockRequestedAt, at)
  const { rows: audits } = await ctx.db.query("SELECT target FROM audit_log WHERE action = 'remote_relock'")
  assert.deepEqual(audits.map((r) => r.target), [fy.kid.id])
  const { rows: woken } = await ctx.db.query("SELECT kind FROM push_outbox WHERE event = 'config' AND ref = $1", [fy.kid.id])
  assert.equal(woken.length, 1)
  assert.equal(woken[0].kind, 'data', 'réveil silencieux')

  // Le téléphone reverrouille : plus rien d'ouvert, une nouvelle demande n'écrit rien.
  assert.equal((await report(fy.device, { remainingS: 0 })).statusCode, 200)
  const again = await relock(owner, fy.kid.id)
  assert.equal(again.json().relockRequestedAt, at)
  assert.equal((await ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'remote_relock'")).rows.length, 1)
})

test('reverrouillage : une demande à distance encore ouverte est annulée, même sans rapport du téléphone', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await unlock(owner, fy.kid.id)).statusCode, 200)
  const res = await relock(owner, fy.kid.id)
  assert.equal(res.statusCode, 200)
  assert.notEqual(res.json().relockRequestedAt, null)
  const cfg = (await config(fy.device)).json()
  assert.equal(cfg.remoteUnlockUntil, null)
  assert.equal(cfg.relockRequestedAt, res.json().relockRequestedAt)
})

test('reverrouillage : contact 403 quel que soit le corps, autre famille et inconnu 404', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const member = await join(owner, 'member')
  const fy = await pairedChild(owner, 'Fy')
  await report(fy.device, { remainingS: 600, openedAgoS: 0, source: 'code' })
  assert.equal((await relock(member, fy.kid.id)).statusCode, 403)
  assert.equal((await relock(member, fy.kid.id, { force: true })).statusCode, 403)
  const stranger = await newUser(ctx)
  await family(stranger)
  assert.equal((await relock(stranger, fy.kid.id)).statusCode, 404)
  assert.equal((await relock(owner, randomUUID())).statusCode, 404)
  assert.equal((await relock(owner, 'pas-un-uuid')).statusCode, 404)
  assert.equal((await kidOf(owner, fy.kid.id)).relockRequestedAt, null, 'aucun refus n’écrit')
  assert.equal((await ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'remote_relock' AND target = $1", [fy.kid.id])).rows.length, 0)
})

test('verrouillé après une sortie à distance : la demande appliquée est effacée, une demande plus récente reste', async () => {
  const owner = await newUser(ctx)
  await family(owner)
  const fy = await pairedChild(owner, 'Fy')
  assert.equal((await unlock(owner, fy.kid.id)).statusCode, 200)
  // Le téléphone l'applique (ouverte il y a 5 s) puis l'enfant reverrouille.
  assert.equal((await report(fy.device, { remainingS: 840, openedAgoS: 5, source: 'remote' })).statusCode, 200)
  assert.equal((await report(fy.device, { remainingS: 0 })).statusCode, 200)
  const kid = await kidOf(owner, fy.kid.id)
  assert.equal(kid.remoteUnlockUntil, null, 'la demande ne se montre plus ouverte')
  assert.equal(kid.phoneUnlock, null)
  assert.equal((await config(fy.device)).json().remoteUnlockUntil, null)

  // Verrouillé (sortie par le code) : une demande à distance posée entre-temps, pas encore
  // appliquée, n'est jamais effacée par ce rapport.
  assert.equal((await report(fy.device, { remainingS: 600, openedAgoS: 0, source: 'code' })).statusCode, 200)
  assert.equal((await unlock(owner, fy.kid.id)).statusCode, 200)
  assert.equal((await report(fy.device, { remainingS: 0 })).statusCode, 200)
  assert.notEqual((await kidOf(owner, fy.kid.id)).remoteUnlockUntil, null)
  // Ni par la fermeture d'une sortie à distance ouverte AVANT cette demande.
  await ctx.db.query("UPDATE child_devices SET unlocked_until = now() + interval '5 minutes', unlock_source = 'remote', unlock_started_at = now() - interval '20 minutes' WHERE id = $1", [fy.device.device.id])
  assert.equal((await report(fy.device, { remainingS: 0 })).statusCode, 200)
  assert.notEqual((await kidOf(owner, fy.kid.id)).remoteUnlockUntil, null)
})
