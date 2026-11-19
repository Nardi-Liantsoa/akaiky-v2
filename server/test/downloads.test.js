import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { startDb, startApp, call, native, newUser } from './helpers.js'

const APK = Buffer.from('PK\u0003\u0004 faux APK de test')
let dbh, withApk, without, dir
before(async () => {
  dbh = await startDb()
  dir = mkdtempSync(join(tmpdir(), 'downloads-'))
  writeFileSync(join(dir, 'akaiky-enfant.apk'), APK)
  withApk = await startApp(dbh.url, { DOWNLOADS_DIR: dir })
  without = await startApp(dbh.url, { DOWNLOADS_DIR: join(dir, 'absent') })
})
after(async () => { await withApk.close(); await without.close(); rmSync(dir, { recursive: true, force: true }); dbh.stop() })

test('APK enfant servi sans session, type Android, en pièce jointe', async () => {
  const res = await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/vnd.android.package-archive')
  assert.match(res.headers['content-disposition'], /attachment; filename="akaiky-enfant.apk"/)
  assert.deepEqual(res.rawPayload, APK)
  // En-têtes de sécurité habituels posés aussi sur ce fichier.
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  const head = await withApk.app.inject({ method: 'HEAD', url: '/downloads/akaiky-enfant.apk' })
  assert.equal(head.statusCode, 200)
})

test('sans APK dans l’image : 404 ; aucun autre fichier du dossier servi', async () => {
  assert.equal((await without.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk' })).statusCode, 404)
  assert.equal((await withApk.app.inject({ method: 'GET', url: '/downloads/README.md' })).statusCode, 404)
  assert.equal((await withApk.app.inject({ method: 'GET', url: '/downloads/../package.json' })).statusCode, 404)
})

test('ETag : 304 si l’APK n’a pas changé ; limite de téléchargements par IP', async () => {
  const first = await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk' })
  const etag = first.headers.etag
  assert.match(etag, /^"[A-Za-z0-9_-]{43}"$/)
  for (const h of [etag, `W/${etag}`, `"x", ${etag}`, '*']) {
    assert.equal((await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk', headers: { 'if-none-match': h } })).statusCode, 304, h)
  }
  // Les 304 et HEAD ne comptent pas dans la limite : seuls les envois complets.
  for (let i = 0; i < 40; i++) await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk', remoteAddress: '203.0.113.7', headers: { 'if-none-match': etag } })
  assert.equal((await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk', remoteAddress: '203.0.113.7' })).statusCode, 200)
  let last
  for (let i = 0; i < 40; i++) last = await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk', remoteAddress: '203.0.113.9' })
  assert.equal(last.statusCode, 429)
})

test('QR vers ce serveur sans l’APK attendu (absent ou autre certificat) : 503, jamais un lien mort', async () => {
  const env = (downloads) => ({
    DOWNLOADS_DIR: downloads, NATIVE_ORIGINS: 'https://localhost', API_RATE_LIMIT: '100000',
    DEVICE_APK_URL: 'https://APP.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43)
  })
  const pairingStatus = async (ctx) => {
    const owner = await newUser(ctx)
    await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'F' } })
    const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
    return (await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })).statusCode
  }
  const apps = []
  try {
    writeFileSync(join(dir, 'akaiky-enfant.cert-sha256'), 'B'.repeat(43) + '\n')
    apps.push(await startApp(dbh.url, env(join(dir, 'absent'))))
    assert.equal(await pairingStatus(apps.at(-1)), 503)
    apps.push(await startApp(dbh.url, env(dir)))
    assert.equal(await pairingStatus(apps.at(-1)), 503)
    writeFileSync(join(dir, 'akaiky-enfant.cert-sha256'), 'A'.repeat(43) + '\n')
    apps.push(await startApp(dbh.url, env(dir)))
    assert.equal(await pairingStatus(apps.at(-1)), 201)
  } finally {
    for (const a of apps) await a.close()
  }
})

test('mise à jour annoncée (NAR-170) : versionCode, adresse et SHA-256 du fichier embarqué ; ETag lié à la version', async () => {
  const url = 'https://app.test/downloads/akaiky-enfant.apk'
  const env = (extra) => ({
    DOWNLOADS_DIR: dir, NATIVE_ORIGINS: 'capacitor://localhost,https://localhost', API_RATE_LIMIT: '100000',
    DEVICE_APK_URL: url, DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43), ...extra
  })
  // Téléphone appairé sur ce serveur : sa configuration.
  const deviceConfig = async (ctx, etag) => {
    const owner = await newUser(ctx)
    await call(ctx.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'F' } })
    const kid = (await call(ctx.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
    const qr = (await call(ctx.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })).json()
    const token = qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing']
    const device = (await native(ctx.app, 'POST', '/api/device/pair', { body: { token, model: 'Pixel', osVersion: '14', appVersion: '1.0' } })).json()
    return native(ctx.app, 'GET', '/api/device/config', { token: device.accessToken, headers: etag ? { 'if-none-match': etag } : {} })
  }
  const apps = []
  const start = async (extra) => { const a = await startApp(dbh.url, env(extra)); apps.push(a); return a }
  try {
    writeFileSync(join(dir, 'akaiky-enfant.cert-sha256'), 'A'.repeat(43) + '\n')
    const sha = createHash('sha256').update(APK).digest('hex')
    // Version de l'APK embarqué inconnue (fichier de la release absent) : rien d'annoncé.
    assert.equal((await deviceConfig(await start({ DEVICE_APK_VERSION_CODE: '7' }))).json().apk, null)
    writeFileSync(join(dir, 'akaiky-enfant.version-code'), '7\n')
    const v7 = await deviceConfig(await start({ DEVICE_APK_VERSION_CODE: '7' }))
    assert.equal(v7.statusCode, 200, v7.body)
    assert.deepEqual(v7.json().apk, { versionCode: 7, url, sha256: sha })
    assert.ok(v7.headers.etag.includes(`.7.${sha.slice(0, 16)}`), v7.headers.etag)
    // Un DEVICE_APK_SHA256 cohérent avec le fichier embarqué est accepté.
    assert.equal((await deviceConfig(await start({ DEVICE_APK_VERSION_CODE: '7', DEVICE_APK_SHA256: sha }))).json().apk.sha256, sha)

    // Nouvelle version déployée : l'ancien ETag ne vaut plus 304, le téléphone la voit.
    writeFileSync(join(dir, 'akaiky-enfant.version-code'), '8\n')
    const ctx8 = await start({ DEVICE_APK_VERSION_CODE: '8' })
    const owner = await newUser(ctx8)
    await call(ctx8.app, 'POST', '/api/families', { cookie: owner.cookie, body: { name: 'F' } })
    const kid = (await call(ctx8.app, 'POST', '/api/children', { cookie: owner.cookie, body: { parentalConsent: true, firstName: 'Fy' } })).json()
    const qr = (await call(ctx8.app, 'POST', `/api/children/${kid.id}/pairing`, { cookie: owner.cookie })).json()
    const device = (await native(ctx8.app, 'POST', '/api/device/pair', { body: { token: qr.provisioning['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE']['akaiky.pairing'], model: 'P', osVersion: '14', appVersion: '1.0' } })).json()
    const first = await native(ctx8.app, 'GET', '/api/device/config', { token: device.accessToken })
    assert.equal((await native(ctx8.app, 'GET', '/api/device/config', { token: device.accessToken, headers: { 'if-none-match': first.headers.etag } })).statusCode, 304)
    const stale = first.headers.etag.replace(`.8.${sha.slice(0, 16)}`, `.7.${sha.slice(0, 16)}`)
    const seen = await native(ctx8.app, 'GET', '/api/device/config', { token: device.accessToken, headers: { 'if-none-match': stale } })
    assert.equal(seen.statusCode, 200)
    assert.equal(seen.json().apk.versionCode, 8)

    // Incohérences : rien d'annoncé (le téléphone téléchargerait un fichier qu'il refuserait).
    assert.equal((await deviceConfig(await start({ DEVICE_APK_VERSION_CODE: '7', DEVICE_APK_SHA256: 'f'.repeat(64) }))).json().apk, null)
    writeFileSync(join(dir, 'akaiky-enfant.version-code'), '6\n')
    assert.equal((await deviceConfig(await start({ DEVICE_APK_VERSION_CODE: '7' }))).json().apk, null)
    writeFileSync(join(dir, 'akaiky-enfant.version-code'), '7\n')
    assert.equal((await deviceConfig(await start({ DEVICE_APK_VERSION_CODE: '7' }))).json().apk.versionCode, 7)
    // APK servi ailleurs : DEVICE_APK_SHA256 exigé pour l'annoncer.
    const cdn = { DEVICE_APK_URL: 'https://cdn.example.test/akaiky-enfant.apk', DEVICE_APK_VERSION_CODE: '9' }
    assert.equal((await deviceConfig(await start(cdn))).json().apk, null)
    assert.deepEqual((await deviceConfig(await start({ ...cdn, DEVICE_APK_SHA256: 'e'.repeat(64) }))).json().apk, { versionCode: 9, url: cdn.DEVICE_APK_URL, sha256: 'e'.repeat(64) })
  } finally {
    for (const a of apps) await a.close()
    rmSync(join(dir, 'akaiky-enfant.version-code'), { force: true })
  }
})
