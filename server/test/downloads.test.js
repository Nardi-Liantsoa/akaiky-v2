import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDb, startApp } from './helpers.js'

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
  const again = await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk', headers: { 'if-none-match': etag } })
  assert.equal(again.statusCode, 304)
  let last
  for (let i = 0; i < 40; i++) last = await withApk.app.inject({ method: 'GET', url: '/downloads/akaiky-enfant.apk', remoteAddress: '203.0.113.9' })
  assert.equal(last.statusCode, 429)
})

test('QR vers ce serveur sans APK dans l’image : refusé (503), jamais un lien mort', async () => {
  const own = await startApp(dbh.url, {
    DOWNLOADS_DIR: join(dir, 'absent'), NATIVE_ORIGINS: 'https://localhost',
    DEVICE_APK_URL: 'https://app.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43)
  })
  try {
    assert.equal(own.app.childApkMissing, true)
    const embedded = await startApp(dbh.url, {
      DOWNLOADS_DIR: dir, NATIVE_ORIGINS: 'https://localhost',
      DEVICE_APK_URL: 'https://app.test/downloads/akaiky-enfant.apk', DEVICE_APK_SIGNATURE_SHA256: 'A'.repeat(43)
    })
    assert.equal(embedded.app.childApkMissing, false)
    await embedded.close()
  } finally { await own.close() }
})
