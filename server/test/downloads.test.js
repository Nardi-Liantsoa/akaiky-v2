import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDb, startApp, call, newUser } from './helpers.js'

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
