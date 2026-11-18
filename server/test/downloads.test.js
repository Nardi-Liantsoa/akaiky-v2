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
