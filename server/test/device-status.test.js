import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser, tokenIn } from './helpers.js'
import { createPool } from '../src/db.js'
import { runRetention } from '../src/jobs.js'
import { createFakeProvider, runPushWorker } from '../src/push.js'
import { runSilentWatch } from '../src/device-status.js'
import { HEARTBEAT_MAX } from '../src/routes/device-status.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx, fake
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', INVITATION_EMAILS_PER_HOUR: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })
beforeEach(async () => { await ctx.db.query('DELETE FROM push_outbox'); fake = createFakeProvider() })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const silent = { info() {}, warn() {}, error() {} }
const work = () => runPushWorker(ctx.db, fake, ctx.app.config, silent)
const OK = { batteryPct: 80, charging: false, network: 'wifi', simState: 'ready' }
// Signal de la surveillance native en arrière-plan (NAR-180) : seul surveillé pour le silence.
const BG = { ...OK, background: true }
const beat = (device, body) => native(ctx.app, 'POST', '/api/device/heartbeat', { token: device.accessToken, body })
const status = (u, childId) => call(ctx.app, 'GET', `/api/children/${childId}/status`, { cookie: u.cookie })
const putToken = (u, lang = 'fr') => call(ctx.app, 'PUT', '/api/push/token', { cookie: u.cookie, body: { token: `fcm-${randomUUID()}`, platform: 'android', lang } })
const alertsOf = async (deviceId) => (await ctx.db.query(
  'SELECT kind, closed_at FROM device_alerts WHERE device_id = $1 ORDER BY opened_at, kind', [deviceId])).rows
const openKinds = async (deviceId) => (await alertsOf(deviceId)).filter((a) => !a.closed_at).map((a) => a.kind)
const outbox = async () => (await ctx.db.query('SELECT event, ref FROM push_outbox ORDER BY created_at')).rows
const closedAgo = (deviceId, kind, minutes) => ctx.db.query(
  `UPDATE device_alerts SET closed_at = now() - make_interval(mins => $3), opened_at = LEAST(opened_at, now() - make_interval(mins => $3))
    WHERE device_id = $1 AND kind = $2 AND closed_at IS NOT NULL`, [deviceId, kind, minutes])
const age = (deviceId, minutes) => ctx.db.query(`UPDATE child_devices SET status_at = now() - make_interval(mins => $2) WHERE id = $1`, [deviceId, minutes])

async function join(owner, role) {
  const guest = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families/me/invitations', { cookie: owner.cookie, body: { email: guest.email, role } })
  const token = tokenIn(ctx.sent.findLast((m) => m.to === guest.email && m.text.includes('#invite=')), 'invite')
  await call(ctx.app, 'POST', '/api/invitations/accept', { cookie: guest.cookie, body: { token } })
  return guest
}
async function pair(owner, kid) {
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a' } })
  assert.equal(res.statusCode, 201, res.body)
  return res.json()
}
async function familyWithChild(firstName = 'Fy') {
  const owner = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName } })).json()
  return { owner, kid, device: await pair(owner, kid) }
}

test('signal : relevés enregistrés sur CE téléphone, lus par les membres champ par champ', async () => {
  const { owner, kid, device } = await familyWithChild()
  const member = await join(owner, 'member')
  const before = await status(member, kid.id)
  assert.equal(before.statusCode, 200, before.body)
  assert.deepEqual(before.json().devices.map((d) => [d.batteryPct, d.statusAt, d.alerts]), [[null, null, []]], 'aucun signal encore')
  const r = await beat(device, { batteryPct: 57, charging: true, network: 'mobile', simState: 'ready' })
  assert.equal(r.statusCode, 200, r.body)
  const { devices } = (await status(member, kid.id)).json()
  assert.equal(devices.length, 1)
  assert.deepEqual(Object.keys(devices[0]).sort(), ['alerts', 'batteryPct', 'charging', 'id', 'model', 'network', 'simState', 'statusAt'])
  assert.deepEqual({ ...devices[0], statusAt: undefined, id: undefined },
    { model: 'Pixel 3a', batteryPct: 57, charging: true, network: 'mobile', simState: 'ready', alerts: [], statusAt: undefined, id: undefined })
  assert.ok(Math.abs(Date.parse(devices[0].statusAt) - Date.now()) < 60_000)
  // Batterie et charge inconnues (null), réseau inconnu acceptés (relevé natif en échec).
  assert.equal((await beat(device, { batteryPct: null, charging: null, network: 'unknown', simState: 'unknown' })).statusCode, 200)
  const unknown = (await status(owner, kid.id)).json().devices[0]
  assert.deepEqual([unknown.batteryPct, unknown.charging, unknown.network, unknown.simState], [null, null, 'unknown', 'unknown'])
  // `background` facultatif, faux par défaut ; une fois vrai, jamais remis à faux par un signal.
  const bg = async () => (await ctx.db.query('SELECT background_status FROM child_devices WHERE id = $1', [device.device.id])).rows[0].background_status
  assert.equal(await bg(), false)
  assert.equal((await beat(device, BG)).statusCode, 200)
  assert.equal(await bg(), true)
  assert.equal((await beat(device, OK)).statusCode, 200)
  assert.equal(await bg(), true, 'signal de premier plan : la surveillance reste')
  assert.equal((await beat(device, { ...OK, background: false })).statusCode, 200)
  assert.equal(await bg(), true, 'background faux : la surveillance reste')
})

test('signal : corps vérifié à la main ; aucun identifiant de téléphone ni d’enfant accepté ; session d’appareil exigée', async () => {
  const { owner, device } = await familyWithChild()
  const other = await familyWithChild()
  for (const extra of [{ deviceId: other.device.device.id }, { childId: other.kid.id }, { id: randomUUID() }, { familyId: randomUUID() }]) {
    assert.equal((await beat(device, { ...OK, ...extra })).statusCode, 400, JSON.stringify(extra))
  }
  for (const bad of [{ batteryPct: 101 }, { batteryPct: -1 }, { batteryPct: 12.5 }, { batteryPct: '50' }, { charging: 'yes' },
    { network: 'cellular' }, { network: undefined }, { simState: 'gone' }, { simState: undefined },
    { background: 'yes' }, { background: null }, { background: 1 }]) {
    assert.equal((await beat(device, { ...OK, ...bad })).statusCode, 400, JSON.stringify(bad))
  }
  assert.equal((await beat(device, [OK])).statusCode, 400)
  assert.equal((await native(ctx.app, 'POST', '/api/device/heartbeat', { body: OK })).statusCode, 401)
  const byAccount = await call(ctx.app, 'POST', '/api/device/heartbeat', { cookie: owner.cookie, body: OK })
  assert.ok([401, 403].includes(byAccount.statusCode), `session de compte refusée (${byAccount.statusCode})`)
  // L'autre téléphone n'a reçu aucun relevé.
  const { rows: [row] } = await ctx.db.query('SELECT status_at, battery_pct FROM child_devices WHERE id = $1', [other.device.device.id])
  assert.deepEqual(row, { status_at: null, battery_pct: null })
})

test('signal : environ un par minute et par téléphone', async () => {
  const { device } = await familyWithChild()
  const { device: neighbour } = await familyWithChild()
  for (let i = 0; i < HEARTBEAT_MAX; i++) assert.equal((await beat(device, OK)).statusCode, 200)
  assert.equal((await beat(device, OK)).statusCode, 429)
  assert.equal((await beat(neighbour, OK)).statusCode, 200, 'un autre téléphone n’est pas freiné')
})

test('batterie < 15 % hors charge : une alerte et une notification (prénom seul) ; pas de doublon ; fermée à 20 % (hystérésis)', async () => {
  const { owner, kid, device } = await familyWithChild('Fy')
  const deviceId = device.device.id
  await putToken(owner, 'fr')
  assert.equal((await beat(device, { ...OK, batteryPct: 14 })).statusCode, 200)
  assert.deepEqual(await openKinds(deviceId), ['battery_low'])
  assert.deepEqual(await outbox(), [{ event: 'battery_low', ref: kid.id }])
  assert.equal((await work()).sent, 1)
  const { message } = fake.sent[0]
  assert.deepEqual(message.notification, { title: 'Batterie faible : téléphone de Fy', body: 'Ouvrez Akaiky pour voir son état.' })
  assert.deepEqual(message.data, { type: 'battery_low', id: kid.id }, 'type et enfant seulement')
  // Hors identifiant de l'enfant (un UUID peut contenir « 14 ») : ni le niveau ni aucune autre donnée.
  assert.ok(!JSON.stringify({ ...message, data: { ...message.data, id: undefined } }).includes('14'), 'ni le niveau ni aucune autre donnée')
  const shown = (await status(owner, kid.id)).json().devices[0].alerts
  assert.deepEqual(shown.map((a) => a.kind), ['battery_low'])
  assert.deepEqual(Object.keys(shown[0]).sort(), ['kind', 'openedAt'])

  assert.equal((await beat(device, { ...OK, batteryPct: 9 })).statusCode, 200)
  assert.equal((await outbox()).length, 1, 'deuxième relevé faible : aucune nouvelle notification')
  await beat(device, { ...OK, batteryPct: 17 })
  assert.deepEqual(await openKinds(deviceId), ['battery_low'], 'entre 15 et 19 % : toujours ouverte')
  await beat(device, { ...OK, batteryPct: 25 })
  assert.deepEqual(await openKinds(deviceId), [], 'fermée')
  assert.equal((await status(owner, kid.id)).json().devices[0].alerts.length, 0)
  assert.equal((await outbox()).length, 1, 'fermeture sans notification')
})

test('batterie faible en charge : pas d’alerte ; la charge seule ne ferme pas une alerte ouverte, 20 % la ferme', async () => {
  const { device } = await familyWithChild()
  const deviceId = device.device.id
  await beat(device, { ...OK, batteryPct: 5, charging: true })
  assert.deepEqual(await openKinds(deviceId), [])
  await beat(device, { ...OK, batteryPct: 5, charging: false })
  assert.deepEqual(await openKinds(deviceId), ['battery_low'])
  await beat(device, { ...OK, batteryPct: 6, charging: true })
  assert.deepEqual(await openKinds(deviceId), ['battery_low'], 'en charge à 6 % : toujours ouverte')
  await beat(device, { ...OK, batteryPct: 19, charging: true })
  assert.deepEqual(await openKinds(deviceId), ['battery_low'], 'en charge à 19 % : toujours ouverte')
  await beat(device, { ...OK, batteryPct: 20, charging: true })
  assert.deepEqual(await openKinds(deviceId), [], '20 % : fermée')
})

test('batterie : fermée depuis moins de 60 minutes → aucune nouvelle alerte ni notification ; au-delà, nouvelle alerte', async () => {
  const { owner, kid, device } = await familyWithChild()
  const deviceId = device.device.id
  await putToken(owner)
  await beat(device, { ...OK, batteryPct: 14 })
  await beat(device, { ...OK, batteryPct: 20 })
  assert.deepEqual(await openKinds(deviceId), [])
  assert.equal((await outbox()).length, 1)
  await closedAgo(deviceId, 'battery_low', 59)
  await beat(device, { ...OK, batteryPct: 13 })
  assert.deepEqual(await openKinds(deviceId), [], 'fermée il y a 59 minutes : rien')
  assert.equal((await outbox()).length, 1, 'aucune nouvelle notification')
  await closedAgo(deviceId, 'battery_low', 61)
  await beat(device, { ...OK, batteryPct: 13 })
  assert.deepEqual(await openKinds(deviceId), ['battery_low'], 'fermée il y a 61 minutes : nouvelle alerte')
  assert.deepEqual(await outbox(), [{ event: 'battery_low', ref: kid.id }, { event: 'battery_low', ref: kid.id }])
  // Un autre téléphone n'est pas concerné par cette attente.
  const { device: other } = await familyWithChild()
  await beat(other, { ...OK, batteryPct: 14 })
  assert.deepEqual(await openKinds(other.device.id), ['battery_low'])
})

test('carte SIM absente : alerte et notification (malgache) ; fermée quand elle est prête', async () => {
  const { owner, kid, device } = await familyWithChild('Tiana')
  const deviceId = device.device.id
  await putToken(owner, 'mg')
  await beat(device, { ...OK, simState: 'absent' })
  await beat(device, { ...OK, simState: 'absent' })
  assert.deepEqual(await openKinds(deviceId), ['sim_absent'])
  assert.deepEqual(await outbox(), [{ event: 'sim_absent', ref: kid.id }])
  await work()
  assert.equal(fake.sent[0].message.notification.title, 'Tsy misy karatra SIM ny findain’i Tiana')
  assert.deepEqual(fake.sent[0].message.data, { type: 'sim_absent', id: kid.id })
  await beat(device, { ...OK, simState: 'locked' })
  assert.deepEqual(await openKinds(deviceId), ['sim_absent'], 'verrouillée : rien ne change')
  await beat(device, OK)
  assert.deepEqual(await openKinds(deviceId), [])
})

test('silence de 60 minutes : une alerte et une notification ; pas de doublon ; le signal suivant la ferme sans notifier', async () => {
  const { owner, kid, device } = await familyWithChild('Fy')
  const { device: never } = await familyWithChild('Rado')
  const deviceId = device.device.id
  await putToken(owner, 'en')
  await beat(device, BG)
  await age(deviceId, 59)
  await runSilentWatch(ctx.db)
  assert.deepEqual(await openKinds(deviceId), [], '59 minutes : rien')
  await age(deviceId, 61)
  assert.ok(await runSilentWatch(ctx.db) >= 1)
  assert.deepEqual(await openKinds(deviceId), ['silent'])
  assert.deepEqual(await openKinds(never.device.id), [], 'jamais de signal : jamais « silencieux »')
  assert.deepEqual(await outbox(), [{ event: 'silent', ref: kid.id }])
  await work()
  assert.deepEqual(fake.sent[0].message.notification, { title: 'Fy’s phone is not responding', body: 'No signal for more than an hour.' })
  assert.deepEqual(fake.sent[0].message.data, { type: 'silent', id: kid.id })
  await runSilentWatch(ctx.db)
  assert.equal((await alertsOf(deviceId)).length, 1, 'second tour : aucun doublon')
  assert.equal((await outbox()).length, 1)
  assert.deepEqual((await status(owner, kid.id)).json().devices[0].alerts.map((a) => a.kind), ['silent'])
  await beat(device, BG)
  assert.deepEqual(await openKinds(deviceId), [])
  assert.equal((await outbox()).length, 1, 'retour sans notification')
  // Nouveau silence après le retour : nouvelle alerte.
  await age(deviceId, 61)
  await runSilentWatch(ctx.db)
  assert.deepEqual(await openKinds(deviceId), ['silent'])
})

test('veille « silence » : deux instances simultanées n’ouvrent qu’une alerte ; verrou tenu ailleurs → tour passé', async () => {
  const { owner, device } = await familyWithChild()
  const deviceId = device.device.id
  await putToken(owner)
  await beat(device, BG)
  await age(deviceId, 90)
  const a = createPool(dbh.url), b = createPool(dbh.url)
  const holder = await ctx.db.connect()
  try {
    await Promise.all([runSilentWatch(a), runSilentWatch(b), runSilentWatch(a), runSilentWatch(b)])
    assert.equal((await alertsOf(deviceId)).length, 1)
    assert.equal((await outbox()).length, 1, 'une seule notification')
    await ctx.db.query('UPDATE device_alerts SET closed_at = now() WHERE device_id = $1', [deviceId])
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('akaiky:silent'))")
    assert.equal(await runSilentWatch(a), null, 'verrou tenu : tour passé')
    assert.deepEqual(await openKinds(deviceId), [])
    await holder.query('ROLLBACK')
    assert.ok(await runSilentWatch(a) >= 1)
    assert.deepEqual(await openKinds(deviceId), ['silent'])
  } finally {
    holder.release(); await a.end(); await b.end()
  }
})

test('silence : un téléphone sans surveillance en arrière-plan n’a jamais d’alerte « silence »', async () => {
  const { owner, device } = await familyWithChild()
  const deviceId = device.device.id
  await putToken(owner)
  // App au premier plan seule (client JS actuel) : background absent, donc faux.
  await beat(device, OK)
  await age(deviceId, 600)
  await runSilentWatch(ctx.db)
  assert.deepEqual(await openKinds(deviceId), [], 'premier plan seul : jamais « silencieux »')
  assert.deepEqual(await outbox(), [])
})

test('silence : un signal de premier plan après le signal natif ne lève pas la surveillance ; réappairage = nouvelle ligne non surveillée', async () => {
  const { owner, kid, device } = await familyWithChild()
  const deviceId = device.device.id
  await putToken(owner)
  await beat(device, BG)
  // L'enfant ouvre l'app : signal JS sans `background`.
  await beat(device, OK)
  await age(deviceId, 61)
  assert.ok(await runSilentWatch(ctx.db) >= 1)
  assert.deepEqual(await openKinds(deviceId), ['silent'], 'toujours surveillé : alerte après 61 minutes')
  // Réappairage : nouveau téléphone, à faux tant qu'aucun signal natif.
  const again = await pair(owner, kid)
  await beat(again, OK)
  await age(again.device.id, 600)
  await runSilentWatch(ctx.db)
  assert.deepEqual(await openKinds(again.device.id), [])
})

test('état : autre famille → 404 ; identifiant invalide → 404 ; téléphone révoqué absent et plus surveillé', async () => {
  const { owner, kid, device } = await familyWithChild()
  const stranger = await familyWithChild()
  const loner = await newUser(ctx)
  assert.equal((await status(stranger.owner, kid.id)).statusCode, 404)
  assert.equal((await status(loner, kid.id)).statusCode, 404)
  assert.equal((await status(owner, 'pas-un-uuid')).statusCode, 404)
  assert.equal((await status(owner, randomUUID())).statusCode, 404)
  assert.equal((await call(ctx.app, 'GET', `/api/children/${kid.id}/status`)).statusCode, 401)
  await beat(device, { ...BG, batteryPct: 3 })
  const second = await pair(owner, kid)
  await beat(second, OK)
  assert.equal((await status(owner, kid.id)).json().devices.length, 2)
  assert.equal((await call(ctx.app, 'POST', `/api/devices/${device.device.id}/revoke`, { cookie: owner.cookie })).statusCode, 200)
  const { devices } = (await status(owner, kid.id)).json()
  assert.deepEqual(devices.map((d) => [d.id, d.alerts.length]), [[second.device.id, 0]])
  assert.deepEqual(await openKinds(device.device.id), [], 'révocation : alertes fermées')
  await age(device.device.id, 120)
  await runSilentWatch(ctx.db)
  assert.deepEqual(await openKinds(device.device.id), [], 'révoqué : jamais « silencieux »')
  assert.equal((await beat(device, OK)).statusCode, 401)
})

test('purge : alertes fermées depuis 90 jours effacées ; les autres gardées', async () => {
  const { device } = await familyWithChild()
  const { rows: [ids] } = await ctx.db.query('SELECT id, family_id, child_id FROM child_devices WHERE id = $1', [device.device.id])
  const insert = async (kind, openedDays, closedDays) => (await ctx.db.query(
    `INSERT INTO device_alerts(family_id, child_id, device_id, kind, opened_at, closed_at)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5), CASE WHEN $6::int IS NULL THEN NULL ELSE now() - make_interval(days => $6::int) END)
     RETURNING id`, [ids.family_id, ids.child_id, ids.id, kind, openedDays, closedDays])).rows[0].id
  const old = await insert('battery_low', 100, 91)
  const recent = await insert('battery_low', 100, 89)
  const open = await insert('silent', 200, null)
  await ctx.db.query("UPDATE job_runs SET started_at = NULL WHERE job = 'retention'")
  const result = await runRetention(ctx.db, silent)
  assert.ok(result?.deviceAlerts >= 1, JSON.stringify(result))
  const left = (await ctx.db.query('SELECT id FROM device_alerts WHERE id = ANY($1::uuid[])', [[old, recent, open]])).rows.map((r) => r.id)
  assert.deepEqual(left.sort(), [recent, open].sort())
})
