// Fond de carte auto-hébergé (NAR-205) : lecture par morceaux, polices, aucune session exigée,
// cache gardé, CORS des apps natives.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { startDb, startApp, call } from './helpers.js'

const FILE = new URL('../../tests/fixtures/map/tana.pmtiles', import.meta.url).pathname
const SIZE = statSync(FILE).size
let dbh, ctx, none
before(async () => {
  dbh = await startDb()
  ctx = await startApp(dbh.url, { MAP_TILES_FILE: FILE })
  none = await startApp(dbh.url, {})
})
after(async () => { await ctx.close(); await none.close(); dbh.stop() })

const get = (app, path, headers = {}) => app.inject({ method: 'GET', url: path, headers })

test('tuiles : un intervalle d’octets (206), sans session, gardé une journée ; Range de l’app native permis', async () => {
  const res = await get(ctx.app, '/api/map/tiles.pmtiles', { range: 'bytes=0-126' })
  assert.equal(res.statusCode, 206)
  assert.equal(res.headers['content-range'], `bytes 0-126/${SIZE}`)
  assert.equal(res.rawPayload.length, 127)
  assert.deepEqual(res.rawPayload, readFileSync(FILE).subarray(0, 127))
  assert.equal(res.rawPayload.subarray(0, 7).toString(), 'PMTiles')
  assert.equal(res.headers['cache-control'], 'private, max-age=86400')
  assert.ok(res.headers.etag)
  // Fin ouverte et fin au-delà du fichier : bornées à sa taille.
  const tail = await get(ctx.app, '/api/map/tiles.pmtiles', { range: `bytes=${SIZE - 10}-` })
  assert.equal(tail.statusCode, 206)
  assert.equal(tail.rawPayload.length, 10)
  assert.equal((await get(ctx.app, '/api/map/tiles.pmtiles', { range: `bytes=${SIZE - 5}-${SIZE + 100}` })).rawPayload.length, 5)
  // Intervalles invalides ou multiples : 416.
  for (const range of [`bytes=${SIZE}-`, 'bytes=10-5', 'bytes=0-1,5-6', 'octets=0-1', 'bytes=-5']) {
    const bad = await get(ctx.app, '/api/map/tiles.pmtiles', { range })
    assert.equal(bad.statusCode, 416, range)
    assert.equal(bad.headers['cache-control'], 'no-store')
  }
  // Fichier entier, puis 304 sur le même ETag.
  const whole = await get(ctx.app, '/api/map/tiles.pmtiles')
  assert.equal(whole.statusCode, 200)
  assert.equal(whole.rawPayload.length, SIZE)
  assert.equal((await get(ctx.app, '/api/map/tiles.pmtiles', { 'if-none-match': whole.headers.etag })).statusCode, 304)
  // Pré-vol de l'app native : l'en-tête Range est permis, content-range exposé.
  const pre = await ctx.app.inject({ method: 'OPTIONS', url: '/api/map/tiles.pmtiles', headers: { origin: 'https://localhost', 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' } })
  assert.equal(pre.statusCode, 204)
  assert.match(pre.headers['access-control-allow-headers'], /\brange\b/)
  const native = await get(ctx.app, '/api/map/tiles.pmtiles', { origin: 'https://localhost', range: 'bytes=0-9' })
  assert.equal(native.headers['access-control-allow-origin'], 'https://localhost')
  assert.match(native.headers['access-control-expose-headers'], /content-range/)
})

test('polices : liste fermée, jamais un chemin du disque ; carte non configurée : 404', async () => {
  const font = await get(ctx.app, '/api/map/fonts/noto-sans-regular/0-255.pbf')
  assert.equal(font.statusCode, 200)
  assert.equal(font.headers['content-type'], 'application/x-protobuf')
  assert.ok(font.rawPayload.length > 1000)
  for (const path of ['/api/map/fonts/noto-sans-regular/65536-65791.pbf', '/api/map/fonts/..%2F..%2Fsrc/config.js', '/api/map/fonts/noto-sans-regular/..%2F..%2F..%2Fpackage.json']) {
    assert.ok([400, 404].includes((await get(ctx.app, path)).statusCode), path)
  }
  const off = await get(none.app, '/api/map/tiles.pmtiles', { range: 'bytes=0-9' })
  assert.equal(off.statusCode, 404)
  assert.equal(off.json().code, 'map_unavailable')
  // Écriture : aucune route.
  assert.equal((await call(ctx.app, 'POST', '/api/map/tiles.pmtiles', {})).statusCode, 404)
})
