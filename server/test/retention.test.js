import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDb, startApp, call, native, newUser } from './helpers.js'
import { createPool } from '../src/db.js'
import { runRetention, startJobs } from '../src/jobs.js'

const APK = { DEVICE_APK_URL: 'https://akaiky.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43) }
let dbh, ctx
before(async () => { dbh = await startDb(); ctx = await startApp(dbh.url, { API_RATE_LIMIT: '100000', ...APK }) })
after(async () => { await ctx.close(); dbh.stop() })
// Chaque test repart d'un tour « dû » (la fonction n'en fait qu'un toutes les 20 heures).
beforeEach(async () => { await ctx.db.query("UPDATE job_runs SET started_at = NULL WHERE job = 'retention'") })

const BUNDLE = 'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'
const silent = { info() {}, error() {} }
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000)

async function pairedChild() {
  const owner = await newUser(ctx)
  await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'Famille' } })
  const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
  const qr = await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })
  const res = await native(ctx.app, 'POST', '/api/device/pair', { body: { token: qr.json().provisioning[BUNDLE]['akaiky.pairing'], model: 'Pixel 3a' } })
  const { rows: [d] } = await ctx.db.query('SELECT id, family_id, child_id FROM child_devices WHERE child_id = $1', [kid.id])
  return { owner, kid, device: res.json(), ids: d }
}
// `days` : âge à la réception par le serveur (created_at, qui compte pour la purge) ;
// `startedDays` : heure du téléphone, éventuellement bien plus ancienne (envoi tardif).
async function event(ids, days, startedDays = days) {
  const id = randomUUID()
  await ctx.db.query(`INSERT INTO device_events(id, family_id, child_id, device_id, kind, started_at, created_at) VALUES ($1, $2, $3, $4, 'call_blocked', $5, $6)`,
    [id, ids.family_id, ids.child_id, ids.id, daysAgo(startedDays), daysAgo(days)])
  return id
}
async function message(ids, days) {
  const id = randomUUID()
  await ctx.db.query(`INSERT INTO quick_messages(id, family_id, child_id, device_id, slot, sent_at, created_at) VALUES ($1, $2, $3, $4, 1, $5, $5)`,
    [id, ids.family_id, ids.child_id, ids.id, daysAgo(days)])
  return id
}
async function auditRow(days) {
  const { rows: [r] } = await ctx.db.query(`INSERT INTO audit_log(at, action, ip) VALUES ($1, 'test_retention', '203.0.113.7') RETURNING id`, [daysAgo(days)])
  return r.id
}
const exists = async (table, id) => (await ctx.db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1

test('journaux (reçus) et messages au-delà de 90 jours, audit au-delà d’un an : purgés ; le reste gardé ; IP effacée à 90 jours', async () => {
  const { ids, owner } = await pairedChild()
  // Gardé : appel vieux de 91 jours sur le téléphone mais reçu hier (envoi tardif).
  const oldEvent = await event(ids, 91), keptEvent = await event(ids, 1, 91)
  const oldMessage = await message(ids, 91), keptMessage = await message(ids, 89)
  await ctx.db.query('INSERT INTO quick_message_reads(message_id, user_id) VALUES ($1, $2)', [oldMessage, owner.id])
  const oldAudit = await auditRow(366), midAudit = await auditRow(100), freshAudit = await auditRow(10)

  const result = await runRetention(ctx.db, silent)
  assert.ok(result, 'un tour a eu lieu')
  assert.ok(result.deviceEvents >= 1 && result.quickMessages >= 1 && result.auditLog >= 1 && result.auditIpCleared >= 1, JSON.stringify(result))

  assert.equal(await exists('device_events', oldEvent), false)
  assert.equal(await exists('device_events', keptEvent), true)
  assert.equal(await exists('quick_messages', oldMessage), false)
  assert.equal(await exists('quick_messages', keptMessage), true)
  assert.equal((await ctx.db.query('SELECT 1 FROM quick_message_reads WHERE message_id = $1', [oldMessage])).rowCount, 0, '« vu par » suit son message')
  assert.equal(await exists('audit_log', oldAudit), false)
  const ips = (await ctx.db.query('SELECT id, ip FROM audit_log WHERE id = ANY($1::bigint[])', [[midAudit, freshAudit]])).rows
  assert.deepEqual(Object.fromEntries(ips.map((r) => [r.id, r.ip])), { [midAudit]: null, [freshAudit]: '203.0.113.7' })

  const { rows: [run] } = await ctx.db.query("SELECT started_at, finished_at, result FROM job_runs WHERE job = 'retention'")
  assert.ok(run.finished_at >= run.started_at)
  assert.deepEqual(run.result, result)
})

test('sessions mortes depuis plus de 30 jours et jetons expirés : supprimés ; une session d’app encore renouvelable est gardée', async () => {
  const user = await newUser(ctx)
  const { rows: [u] } = await ctx.db.query('SELECT id FROM users WHERE email = $1', [user.email])
  const dead = randomUUID(), renewable = randomUUID()
  await ctx.db.query(`INSERT INTO sessions(id, user_id, token_hash, expires_at, kind) VALUES ($1, $2, $3, now() - interval '40 days', 'cookie')`,
    [dead, u.id, Buffer.from(randomUUID())])
  await ctx.db.query(`INSERT INTO sessions(id, user_id, token_hash, expires_at, kind, refresh_hash, refresh_expires_at) VALUES ($1, $2, $3, now() - interval '3 days', 'bearer', $4, now() + interval '20 days')`,
    [renewable, u.id, Buffer.from(randomUUID()), Buffer.from(randomUUID())])
  const result = await runRetention(ctx.db, silent)
  assert.ok(result.sessions >= 1)
  assert.equal(await exists('sessions', dead), false)
  assert.equal(await exists('sessions', renewable), true)
  // La session de l'utilisateur, encore valable, passe toujours.
  assert.equal((await call(ctx.app, 'GET', '/api/auth/me', { cookie: user.cookie })).json().user.email, user.email)
})

test('un seul tour toutes les 20 heures, même avec deux instances en même temps', async () => {
  const a = createPool(dbh.url), b = createPool(dbh.url)
  const holder = await a.connect()
  try {
    // Une autre instance tient le verrou : ce tour-ci repart aussitôt, sans rien marquer.
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('akaiky:retention'))")
    assert.equal(await runRetention(b, silent), null)
    const { rows: [run] } = await ctx.db.query("SELECT started_at FROM job_runs WHERE job = 'retention'")
    assert.equal(run.started_at, null)
    await holder.query('ROLLBACK')
    assert.ok(await runRetention(b, silent), 'verrou libéré : le tour a lieu')
    // Juste après : rien (tour récent).
    assert.equal(await runRetention(a, silent), null)
    // 21 heures plus tard : de nouveau dû.
    await ctx.db.query("UPDATE job_runs SET started_at = now() - interval '21 hours' WHERE job = 'retention'")
    assert.ok(await runRetention(b, silent))
  } finally {
    holder.release(); await a.end(); await b.end()
  }
})

test('tâche planifiée : lancée au démarrage, arrêtée proprement ; un échec est journalisé sans rien casser', async () => {
  // Faux pool : un client dédié par tour, rendu après usage ; la purge met 30 ms.
  const calls = [], released = []
  let purgeDone = 0
  const fakeDb = (purge) => ({
    connect: async () => ({
      query: async (sql) => {
        calls.push(sql)
        if (sql.includes('purge_expired')) return purge()
        return { rows: [] }
      },
      release: (err) => { released.push(err ?? null) },
    }),
  })
  const slow = async () => { await new Promise((r) => setTimeout(r, 30)); purgeDone++; return { rows: [{ result: null }] } }
  const stop = startJobs(fakeDb(slow), silent, { everyMs: 20, watch: false })
  await new Promise((r) => setTimeout(r, 75))
  await stop()
  assert.ok(purgeDone >= 2, `au démarrage puis à intervalle (${purgeDone})`)
  assert.equal(released.length, purgeDone, 'arrêt : le tour en cours est attendu, son client rendu')
  assert.deepEqual(calls.slice(0, 3), ["SET statement_timeout = '10min'", 'SELECT purge_expired() AS result', 'RESET statement_timeout'])
  const n = calls.length
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(calls.length, n, 'plus rien après l’arrêt')

  const errors = []
  released.length = 0
  const broken = fakeDb(async () => { throw new Error('base indisponible') })
  assert.equal(await runRetention(broken, { info() {}, error: (o) => errors.push(o) }), null)
  assert.deepEqual(errors, [{ err: 'base indisponible' }])
  assert.equal(released.length, 1, 'client rendu même en cas d’échec')
  const down = { connect: async () => { throw new Error('pool épuisé') } }
  assert.equal(await runRetention(down, { info() {}, error: (o) => errors.push(o) }), null)
})

test('positions reçues depuis plus de 30 jours et demandes de position échues : purgées ; le reste gardé (C20)', async () => {
  const { ids, owner } = await pairedChild()
  const position = async (days) => {
    const { rows: [r] } = await ctx.db.query(
      `INSERT INTO positions(family_id, child_id, device_id, lat_enc, lng_enc, accuracy_m, source, recorded_at, received_at)
       VALUES ($1, $2, $3, '\\x00', '\\x00', 10, 'on_demand', $4, $4) RETURNING id`, [ids.family_id, ids.child_id, ids.id, daysAgo(days)])
    return r.id
  }
  const old = await position(31), kept = await position(29)
  const request = async (userId, days) => (await ctx.db.query(
    `INSERT INTO location_requests(family_id, child_id, user_id, created_at, watch_until)
     VALUES ($1, $2, $3, $4, $4::timestamptz + interval '2 minutes') ON CONFLICT (child_id, user_id) DO UPDATE SET created_at = EXCLUDED.created_at, watch_until = EXCLUDED.watch_until
     RETURNING id`, [ids.family_id, ids.child_id, userId, daysAgo(days)])).rows[0].id
  const oldRequest = await request(owner.id, 2)
  const result = await runRetention(ctx.db, silent)
  assert.ok(result.positions >= 1 && result.locationRequests >= 1, JSON.stringify(result))
  assert.equal(await exists('positions', old), false)
  assert.equal(await exists('positions', kept), true)
  assert.equal(await exists('location_requests', oldRequest), false)
})
