import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { startDb, startApp, ORIGIN } from './helpers.js'
import { otaVerdict, parseTarget, publishProblem, kindFromAppId } from '../src/ota.js'
import { loadConfig } from '../src/config.js'

// Cas partagés avec l'écran (src/lib/otaTarget.test.ts) et la coque (OtaIdentityTest.kt).
const FIXTURE = JSON.parse(readFileSync(new URL('../../tests/fixtures/ota-target-cases.json', import.meta.url), 'utf8'))
const PUBLISH = new URL('../bin/ota-publish.js', import.meta.url).pathname
const run = promisify(execFile)

// Zip minimal (entrées stockées, sans compression), comme `zip -r` du contenu de dist/web.
function makeZip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, content] of Array.isArray(files) ? files : Object.entries(files)) {
    const data = Buffer.from(content), nameBuf = Buffer.from(name), crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(centrals.length / 2, 8); eocd.writeUInt16LE(centrals.length / 2, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
const ZIP = makeZip({ 'index.html': '<!doctype html><title>Akaiky</title>', 'assets/app.js': 'console.log(1)' })
const SHA = createHash('sha256').update(ZIP).digest('hex')

// Corps exact du greffon 8.54.2 sur Android (createInfoObject), pour une coque donnée.
const info = (appId, build, defaultChannel, extra = {}) => ({
  platform: 'android', device_id: '0f8d1a3e-5b7c-4e2a-9c1d-2b3a4c5d6e7f', app_id: appId, custom_id: '',
  version_build: '1.0.0', version_code: build, version_os: '14', version_name: 'builtin', plugin_version: '8.54.2',
  is_emulator: false, is_prod: true, install_source: 'com.android.vending', defaultChannel, ...extra
})

let dbh, ctx, dir
const latest = (body, extra = {}) => ctx.app.inject({ method: 'POST', url: '/api/ota/latest', payload: body, ...extra })
const channelOf = (body) => ctx.app.inject({ method: 'PUT', url: '/api/ota/channel', payload: body })
const insert = (t, version = 'v1', bundle = ZIP) => ctx.db.query(
  'INSERT INTO ota_bundles(app, channel, version, min_native_build, bundle, sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
  [t.app, t.channel, version, t.minNativeBuild, bundle, createHash('sha256').update(bundle).digest('hex')]).then((r) => r.rows[0].id)
const publish = (args, env = {}) => run(process.execPath, [PUBLISH, ...args], { env: { PATH: process.env.PATH, DATABASE_URL: dbh.url, ...env } })
  .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }))

before(async () => {
  dbh = await startDb()
  ctx = await startApp(dbh.url, { OTA_RATE_LIMIT: '100000', OTA_DOWNLOAD_RATE_LIMIT: '100000', API_RATE_LIMIT: '100000' })
  dir = mkdtempSync(join(tmpdir(), 'ota-'))
})
after(async () => { await ctx.close(); rmSync(dir, { recursive: true, force: true }); dbh.stop() })
beforeEach(() => ctx.db.query('DELETE FROM ota_bundles'))

test('règle serveur : même verdict que l’écran sur chaque cas partagé', () => {
  for (const c of FIXTURE.cases) assert.equal(otaVerdict(c.target, c.shell), c.verdict, c.name)
  for (const s of Object.values(FIXTURE.shells)) assert.equal(kindFromAppId(s.applicationId), s.channel)
})

// Chaque cas : la cible est publiée si elle est publiable (sinon la publication ET la base la
// refusent), puis la coque du cas demande une mise à jour sur le canal de la cible et sur son
// propre canal. Elle ne reçoit le bundle que si l'écran l'accepterait.
test('route : bundle servi exactement quand otaVerdict l’accepte (cas partagés)', async () => {
  for (const c of FIXTURE.cases) {
    await ctx.db.query('DELETE FROM ota_bundles')
    const t = parseTarget(c.target)
    const publishable = t && !publishProblem({ ...t, version: 'v1' })
    let id = null
    if (publishable) id = await insert(t)
    else {
      assert.ok(publishProblem({ ...(c.target ?? {}), version: 'v1' }), `${c.name} : publication refusée`)
      // Ce qui atteindrait la base est refusé par ses contraintes, même sans la publication.
      if (c.target && ['string', 'number'].every((k, i) => typeof [c.target.app, c.target.minNativeBuild][i] === k)) {
        await assert.rejects(insert(c.target), /violates check constraint|invalid input syntax/, c.name)
      }
    }
    const own = kindFromAppId(c.shell.appId)
    const channels = [...new Set([typeof c.target?.channel === 'string' && c.target.channel ? c.target.channel : own, own])]
    let served = false
    for (const ch of channels) {
      const res = await latest(info(c.shell.appId, c.shell.build, ch))
      const body = res.json()
      if (body.version) {
        served = true
        assert.equal(res.statusCode, 200)
        assert.equal(body.url, `${ORIGIN}/api/ota/bundles/${id}`, c.name)
        assert.deepEqual(body.target, t, c.name)
        assert.equal(otaVerdict(body.target, c.shell), 'accept', c.name)
      } else {
        assert.ok(body.error, c.name)
        if (c.verdict === 'unknown-shell') assert.equal(res.statusCode, 400, c.name)
      }
    }
    assert.equal(served, c.verdict === 'accept', `${c.name} : ${c.verdict}`)
  }
})

test('une app ne reçoit jamais le bundle de l’autre, même publié en même temps', async () => {
  const parentId = await insert({ app: 'parent', channel: 'parent', minNativeBuild: 1 }, 'p1')
  const childId = await insert({ app: 'enfant', channel: 'enfant', minNativeBuild: 1 }, 'e1')
  await insert({ app: 'parent', channel: 'parent-test', minNativeBuild: 1 }, 'pt1')
  const ask = async (appId, ch) => (await latest(info(appId, '9', ch))).json()
  assert.equal((await ask('mg.nosytech.akaiky', 'parent')).url.split('/').pop(), parentId)
  assert.equal((await ask('mg.nosytech.akaiky.enfant', 'enfant')).url.split('/').pop(), childId)
  assert.equal((await ask('mg.nosytech.akaiky.enfant.debug', 'enfant')).url.split('/').pop(), childId)
  for (const ch of ['parent', 'parent-test', 'production', 'parentale']) {
    const body = await ask('mg.nosytech.akaiky.enfant', ch)
    assert.equal(body.version, undefined, ch); assert.ok(body.error)
  }
  for (const ch of ['enfant', 'enfant-test']) assert.equal((await ask('mg.nosytech.akaiky', ch)).version, undefined, ch)
  assert.equal((await ask('com.example.autre', 'parent')).version, undefined)
})

test('coque minimale : le plus récent bundle que la coque peut faire tourner', async () => {
  await insert({ app: 'enfant', channel: 'enfant', minNativeBuild: 2 }, 'e-ancien')
  await ctx.db.query("UPDATE ota_bundles SET created_at = now() - interval '1 day'")
  await insert({ app: 'enfant', channel: 'enfant', minNativeBuild: 5 }, 'e-recent')
  const version = async (build) => (await latest(info('mg.nosytech.akaiky.enfant', build, 'enfant'))).json().version
  assert.equal(await version('1'), undefined)
  assert.equal(await version('3'), 'e-ancien')
  assert.equal(await version('5'), 'e-recent')
  // Même échelle que la coque parent ? Non : le versionCode parent n'ouvre pas le bundle enfant.
  assert.equal((await latest(info('mg.nosytech.akaiky', '99', 'enfant'))).json().version, undefined)
  // Déjà installé : aucune nouvelle version.
  assert.deepEqual((await latest(info('mg.nosytech.akaiky.enfant', '5', 'enfant', { version_name: 'e-recent' }))).json().error, 'no_new_version_available')
})

test('réponse au format du greffon ; zip servi par identifiant, empreinte exacte', async () => {
  const id = await insert({ app: 'parent', channel: 'parent', minNativeBuild: 3 }, '1.0.0-ota.1')
  const res = await latest(info('mg.nosytech.akaiky', '3', 'parent'))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), {
    version: '1.0.0-ota.1', url: `${ORIGIN}/api/ota/bundles/${id}`, checksum: SHA,
    target: { app: 'parent', channel: 'parent', minNativeBuild: 3 }
  })
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  const zip = await ctx.app.inject({ method: 'GET', url: `/api/ota/bundles/${id}` })
  assert.equal(zip.statusCode, 200)
  assert.equal(zip.headers['content-type'], 'application/zip')
  assert.match(zip.headers['content-disposition'], /^attachment/)
  assert.equal(zip.headers['cache-control'], 'no-store')
  assert.deepEqual(zip.rawPayload, ZIP)
  assert.equal(createHash('sha256').update(zip.rawPayload).digest('hex'), res.json().checksum)
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/ota/bundles/${id}`, headers: { 'if-none-match': `"${SHA}"` } })).statusCode, 304)
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/ota/bundles/${crypto.randomUUID()}` })).statusCode, 404)
  for (const bad of ['../../package.json', 'abc', `${id}.zip`, id.toUpperCase()]) {
    assert.ok([400, 404].includes((await ctx.app.inject({ method: 'GET', url: `/api/ota/bundles/${encodeURIComponent(bad)}` })).statusCode), bad)
  }
})

test('canal : toujours un canal de l’app qui demande, jamais celui d’une autre', async () => {
  const channels = ['parent', 'parent-test', 'enfant', 'enfant-test', 'parentale', 'parent-', 'production', '', 'enfant-Test']
  for (const s of Object.values(FIXTURE.shells).concat([{ applicationId: 'mg.nosytech.akaiky.enfant.debug', channel: 'enfant' }])) {
    for (const ch of channels) {
      const res = await channelOf(info(s.applicationId, '1', ch))
      assert.equal(res.statusCode, 200)
      const body = res.json()
      assert.equal(body.allowSet, false)
      assert.equal(otaVerdict({ app: s.channel, channel: body.channel, minNativeBuild: 1 }, { appId: s.applicationId, build: '1' }), 'accept', `${s.applicationId} ${ch} → ${body.channel}`)
    }
  }
  assert.equal((await channelOf(info('mg.nosytech.akaiky.enfant', '1', 'enfant-test'))).json().channel, 'enfant-test')
  assert.equal((await channelOf(info('mg.nosytech.akaiky.enfant', '1', 'parent'))).json().channel, 'enfant')
  assert.equal((await channelOf(info('mg.nosytech.akaiky', '1', 'enfant'))).json().channel, 'parent')
  const foreign = await channelOf(info('com.example.autre', '1', 'parent'))
  assert.equal(foreign.statusCode, 400); assert.equal(foreign.json().channel, undefined)
  // setChannel, unsetChannel, listChannels : non servis.
  for (const method of ['POST', 'DELETE', 'GET']) {
    assert.equal((await ctx.app.inject({ method, url: '/api/ota/channel', payload: method === 'GET' ? undefined : info('mg.nosytech.akaiky', '1', 'parent') })).statusCode, 404, method)
  }
})

test('entrées : champ inconnu, type faux ou champ manquant refusés ; sans origine ni cookie', async () => {
  await insert({ app: 'parent', channel: 'parent', minNativeBuild: 1 })
  const ok = info('mg.nosytech.akaiky', '2', 'parent')
  assert.equal((await latest(ok)).statusCode, 200)
  // Champs facultatifs du greffon (iOS, chiffrement) acceptés.
  assert.equal((await latest({ ...ok, platform: 'ios', old_version_name: '', action: 'get', channel: 'parent', key_id: 'abc' })).statusCode, 200)
  for (const bad of [{ ...ok, is_admin: true }, { ...ok, version_code: 2 }, { ...ok, app_id: undefined }, { ...ok, defaultChannel: undefined },
    { ...ok, platform: 'web' }, { ...ok, app_id: 'x'.repeat(201) }]) {
    const res = await latest(bad)
    assert.equal(res.statusCode, 400, JSON.stringify(bad)); assert.equal(res.json().version, undefined)
  }
  for (const build of ['', '1.0', '-1', '99999999999', ' 3']) assert.equal((await latest({ ...ok, version_code: build })).statusCode, 400, build)
  // Depuis un navigateur : aucune session lue, aucun contrôle CSRF nécessaire (lecture seule).
  const web = await latest(ok, { headers: { origin: 'https://autre.example', cookie: '__Host-app-session=x' } })
  assert.equal(web.statusCode, 200)
})

test('erreur interne : 500 générique, sans SQL ni chemin', async () => {
  await ctx.db.query('ALTER TABLE ota_bundles RENAME TO ota_bundles_hidden')
  try {
    const res = await latest(info('mg.nosytech.akaiky', '2', 'parent'))
    assert.equal(res.statusCode, 500)
    assert.deepEqual(Object.keys(res.json()), ['error'])
    assert.doesNotMatch(res.body, /ota_bundles|relation|SELECT/)
  } finally { await ctx.db.query('ALTER TABLE ota_bundles_hidden RENAME TO ota_bundles') }
})

test('limites par IP : vérifications et téléchargements', async () => {
  const small = await startApp(dbh.url, { OTA_RATE_LIMIT: '3', OTA_DOWNLOAD_RATE_LIMIT: '2', API_RATE_LIMIT: '100000' })
  try {
    const id = await insert({ app: 'parent', channel: 'parent', minNativeBuild: 1 })
    const ask = (ip) => small.app.inject({ method: 'POST', url: '/api/ota/latest', remoteAddress: ip, payload: info('mg.nosytech.akaiky', '2', 'parent') })
    for (let i = 0; i < 3; i++) assert.equal((await ask('203.0.113.1')).statusCode, 200)
    const limited = await ask('203.0.113.1')
    assert.equal(limited.statusCode, 429); assert.equal(limited.headers['retry-after'], '60'); assert.ok(limited.json().error)
    assert.equal((await ask('203.0.113.2')).statusCode, 200)
    const get = () => small.app.inject({ method: 'GET', url: `/api/ota/bundles/${id}`, remoteAddress: '203.0.113.3' })
    assert.equal((await get()).statusCode, 200); assert.equal((await get()).statusCode, 200)
    assert.equal((await get()).statusCode, 429)
    // Comptée avant la lecture en base : un identifiant inconnu (ou HEAD) consomme aussi le quota.
    const other = (method, path) => small.app.inject({ method, url: `/api/ota/bundles/${path}`, remoteAddress: '203.0.113.4' })
    assert.equal((await other('GET', crypto.randomUUID())).statusCode, 404)
    assert.equal((await other('HEAD', id)).statusCode, 200)
    assert.equal((await other('GET', id)).statusCode, 429)
  } finally { await small.close() }
  for (const v of ['0', 'abc', '1000000']) assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://x', OTA_RATE_LIMIT: v }), /OTA_RATE_LIMIT|numérique/)
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://x', OTA_DOWNLOAD_RATE_LIMIT: '' }))
})

test('publication : cible et zip vérifiés, empreinte calculée, doublon refusé', async () => {
  const zip = join(dir, 'bundle.zip'); writeFileSync(zip, ZIP)
  const noIndex = join(dir, 'sans-index.zip'); writeFileSync(noIndex, makeZip({ 'web/index.html': 'x' }))
  const slip = join(dir, 'slip.zip'); writeFileSync(slip, makeZip({ 'index.html': 'x', '../evil.js': 'x' }))
  const dup = join(dir, 'double.zip'); writeFileSync(dup, makeZip([['index.html', 'a'], ['index.html', 'b']]))
  const notZip = join(dir, 'bundle.txt'); writeFileSync(notZip, 'pas un zip, juste du texte')
  // Répertoire central incohérent : nombre d'entrées faux, en-tête local introuvable, archive tronquée.
  const broken = (name, edit) => { const b = Buffer.from(ZIP); edit(b); const f = join(dir, name); writeFileSync(f, b); return f }
  const eocdAt = ZIP.length - 22, cdAt = ZIP.readUInt32LE(eocdAt + 16)
  const badCount = broken('compte.zip', (b) => { b.writeUInt16LE(3, eocdAt + 8); b.writeUInt16LE(3, eocdAt + 10) })
  const badLocal = broken('local.zip', (b) => b.writeUInt32LE(5, cdAt + 42))
  const cut = join(dir, 'tronque.zip'); writeFileSync(cut, ZIP.subarray(0, ZIP.length - 1))
  // Commentaire d'archive qui recopie la signature de fin : la vraie fin reste trouvée.
  const comment = Buffer.from('PK\x05\x06 commentaire', 'latin1')
  const commented = Buffer.concat([ZIP, comment]); commented.writeUInt16LE(comment.length, eocdAt + 20)
  const withComment = join(dir, 'commentaire.zip'); writeFileSync(withComment, commented)
  const ok = ['--app', 'parent', '--channel', 'parent', '--min-native', '3', '--version', '1.0.0-ota.1']
  const without = (flag) => { const a = [...ok]; a.splice(a.indexOf(flag), 2); return a }
  const refused = [
    [without('--app'), zip], [without('--channel'), zip], [without('--min-native'), zip], [without('--version'), zip], [ok],
    [['--app', 'admin', ...ok.slice(2)], zip],
    [['--app', 'parent', '--channel', 'enfant', ...ok.slice(4)], zip],
    [['--app', 'enfant', '--channel', 'parent', ...ok.slice(4)], zip],
    [['--app', 'parent', '--channel', 'parentale', ...ok.slice(4)], zip],
    [['--app', 'parent', '--channel', 'parent-', ...ok.slice(4)], zip],
    [['--app', 'enfant', '--channel', 'production', ...ok.slice(4)], zip],
    [[...ok.slice(0, 4), '--min-native', '0', ...ok.slice(6)], zip],
    [[...ok.slice(0, 4), '--min-native', '1.5', ...ok.slice(6)], zip],
    [[...ok.slice(0, 4), '--min-native', 'abc', ...ok.slice(6)], zip],
    [[...ok, '--force'], zip],
    [ok, join(dir, 'absent.zip')], [ok, notZip], [ok, noIndex], [ok, slip], [ok, dup], [ok, zip, zip],
    [ok, badCount], [ok, badLocal], [ok, cut]
  ]
  for (const [args, ...files] of refused) {
    const r = await publish([...args, ...files])
    assert.equal(r.code, 2, `${args.join(' ')} ${files.join(' ')} : ${r.stdout}`)
    assert.match(r.stderr, /Refusé/)
  }
  assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM ota_bundles')).rows[0].n, 0)
  assert.equal((await publish([...ok, zip], { DATABASE_URL: '' })).code, 2)

  const done = await publish([...ok, zip])
  assert.equal(done.code, 0, done.stderr)
  const { rows: [row] } = await ctx.db.query('SELECT app, channel, version, min_native_build, sha256, bundle FROM ota_bundles')
  assert.deepEqual({ ...row, bundle: undefined }, { app: 'parent', channel: 'parent', version: '1.0.0-ota.1', min_native_build: 3, sha256: SHA, bundle: undefined })
  assert.deepEqual(row.bundle, ZIP)
  assert.match(done.stdout, new RegExp(SHA))
  const again = await publish([...ok, zip])
  assert.equal(again.code, 2); assert.match(again.stderr, /déjà publiée/)
  // Même zip pour l'app enfant, avec sa propre coque minimale.
  assert.equal((await publish(['--app', 'enfant', '--channel', 'enfant-test', '--min-native', '7', '--version', '1.0.0-ota.1', zip])).code, 0)
  const c = await publish(['--app', 'parent', '--channel', 'parent', '--min-native', '3', '--version', '1.0.0-ota.2', withComment])
  assert.equal(c.code, 0, c.stderr)
  // La base refuse aussi une empreinte qui ne correspond pas au contenu.
  await assert.rejects(ctx.db.query("INSERT INTO ota_bundles(app, channel, version, min_native_build, bundle, sha256) VALUES ('parent','parent','x',1,$1,$2)", [ZIP, 'a'.repeat(64)]), /check constraint/)
})

test('lectures de bundles : quatre au plus en même temps, place rendue après la réponse ou l’erreur', async () => {
  const ids = []
  for (let i = 0; i < 5; i++) ids.push(await insert({ app: 'parent', channel: 'parent', minNativeBuild: 1 }, `c${i}`))
  const fresh = await startApp(dbh.url, { OTA_RATE_LIMIT: '100000', OTA_DOWNLOAD_RATE_LIMIT: '100000', API_RATE_LIMIT: '100000' })
  const get = (id) => fresh.app.inject({ method: 'GET', url: `/api/ota/bundles/${id}` })
  const lock = await ctx.db.connect()
  try {
    // Table verrouillée : les quatre premières lectures attendent, la cinquième est refusée.
    await lock.query('BEGIN'); await lock.query('LOCK TABLE ota_bundles IN ACCESS EXCLUSIVE MODE')
    const waiting = ids.slice(0, 4).map(get)
    await new Promise((r) => setTimeout(r, 200))
    const busy = await get(ids[4])
    assert.equal(busy.statusCode, 503); assert.equal(busy.headers['retry-after'], '30')
    await lock.query('COMMIT')
    for (const res of await Promise.all(waiting)) assert.equal(res.statusCode, 200)
    assert.equal((await get(ids[4])).statusCode, 200)
    // Lecture en échec : la place est rendue, la suivante passe.
    await ctx.db.query('ALTER TABLE ota_bundles RENAME TO ota_bundles_hidden')
    try {
      for (let i = 0; i < 5; i++) assert.equal((await get(crypto.randomUUID())).statusCode, 500)
    } finally { await ctx.db.query('ALTER TABLE ota_bundles_hidden RENAME TO ota_bundles') }
    assert.equal((await get(crypto.randomUUID())).statusCode, 404)
  } finally { await lock.query('ROLLBACK').catch(() => {}); lock.release(); await fresh.close() }
})
