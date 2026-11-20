import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { startDb } from './helpers.js'
import { createPool, migrate, verifySchema } from '../src/db.js'

// Migrations figées (NAR-198) : chaque migration appliquée garde son empreinte SHA-256 ;
// un fichier modifié après coup arrête migrate et le mode verify.
const SOURCE = fileURLToPath(new URL('../src/migrations/', import.meta.url))
const MIGRATE_BIN = fileURLToPath(new URL('../bin/migrate.js', import.meta.url))
const FILE = '023_allowed_apps.sql'
const sha = (s) => createHash('sha256').update(s).digest('hex')
const run = promisify(execFile)

// Copie jetable du dossier des migrations : le dépôt n'est jamais touché.
function copyMigrations() {
  const path = mkdtempSync(join(tmpdir(), 'migrations-'))
  cpSync(SOURCE, path, { recursive: true })
  return { path, dir: pathToFileURL(`${path}/`), rm: () => rmSync(path, { recursive: true, force: true }) }
}

async function runtimePool(owner, url) {
  const sql = readFileSync(new URL('../../ops/runtime-role.sql', import.meta.url), 'utf8').replace(":'runtime_password'", "'runtime-test-only'")
  await owner.query(sql)
  const u = new URL(url); u.username = 'app_runtime'; u.password = 'runtime-test-only'
  return createPool(u.toString())
}

test('migrations : empreinte enregistrée, fichier modifié refusé par migrate et verify', async () => {
  const db = await startDb(), owner = createPool(db.url), copy = copyMigrations()
  let runtime
  try {
    const first = await migrate(owner)
    assert.ok(first.applied.includes(FILE))
    const { rows } = await owner.query('SELECT name, checksum FROM schema_migrations ORDER BY name')
    assert.deepEqual(rows.map((r) => r.name), readdirSync(SOURCE).filter((f) => f.endsWith('.sql')).sort())
    for (const r of rows) assert.equal(r.checksum, sha(readFileSync(join(SOURCE, r.name), 'utf8')), r.name)
    assert.deepEqual(await migrate(owner), { applied: [], backfilled: [] }, 'rejouable')

    runtime = await runtimePool(owner, db.url)
    assert.deepEqual(await verifySchema(runtime), { unchecked: [] })
    // Le rôle restreint ne peut pas réécrire une empreinte.
    await assert.rejects(runtime.query("UPDATE schema_migrations SET checksum = NULL"), /permission denied/)

    // Fins de ligne Windows : même empreinte, aucune alerte.
    const original = readFileSync(join(copy.path, FILE), 'utf8')
    writeFileSync(join(copy.path, FILE), original.replace(/\n/g, '\r\n'))
    assert.deepEqual(await verifySchema(runtime, { dir: copy.dir }), { unchecked: [] })
    assert.deepEqual(await migrate(owner, { dir: copy.dir }), { applied: [], backfilled: [] })

    // 023 modifiée après application (comme 980a5b7) : refus des deux côtés, message
    // qui nomme le fichier et dit quoi faire ; aucune migration en attente n'est jouée.
    writeFileSync(join(copy.path, FILE), original.replace('updated_at timestamptz', 'extra boolean, updated_at timestamptz'))
    writeFileSync(join(copy.path, '999_suivante.sql'), 'CREATE TABLE apres_derive(id int);')
    const drift = (e) => e.code === 'MIGRATION_DRIFT' && e.message.includes(FILE) && /nouvelle migration/.test(e.message)
      && /HANDOFF\.md/.test(e.message) && !e.message.includes('001_init.sql')
    await assert.rejects(migrate(owner, { dir: copy.dir }), drift)
    await assert.rejects(verifySchema(runtime, { dir: copy.dir }), drift)
    assert.equal((await owner.query("SELECT to_regclass('apres_derive') AS t")).rows[0].t, null)
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '999_suivante.sql'")).rows[0].n, 0)

    // Migrations plus récentes que l'image (retour arrière) : lignes sans fichier ignorées.
    await owner.query("INSERT INTO schema_migrations(name, checksum) VALUES ('998_image_suivante.sql', 'abc')")
    assert.deepEqual(await verifySchema(runtime), { unchecked: [] })
    assert.deepEqual(await migrate(owner), { applied: [], backfilled: [] })
  } finally {
    if (runtime) await runtime.end()
    await owner.end(); copy.rm(); db.stop()
  }
})

test('migrations : empreinte enregistrée qui diffère, refus de server/bin/migrate.js', async () => {
  const db = await startDb(), owner = createPool(db.url)
  try {
    await migrate(owner)
    await owner.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [FILE, 'f'.repeat(64)])
    const res = await run(process.execPath, [MIGRATE_BIN], { env: { ...process.env, DATABASE_URL: db.url } }).then(() => null, (e) => e)
    assert.ok(res, 'migrate.js doit échouer')
    assert.equal(res.code, 1)
    assert.match(res.stderr, /Migration 023_allowed_apps\.sql modifiée après application/)
    assert.match(res.stderr, /écrire la correction dans une nouvelle migration/)
    await assert.rejects(migrate(owner), /023_allowed_apps\.sql/)
  } finally { await owner.end(); db.stop() }
})

test('migrations : base antérieure sans empreinte, verify accepte, migrate enregistre (premier usage)', async () => {
  const db = await startDb(), owner = createPool(db.url)
  let runtime
  try {
    await migrate(owner)
    runtime = await runtimePool(owner, db.url)
    // Base d'avant NAR-198 : pas de colonne checksum. Le rôle restreint démarre quand même.
    await owner.query('ALTER TABLE schema_migrations DROP COLUMN checksum')
    const all = (await owner.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name)
    assert.deepEqual(await verifySchema(runtime), { unchecked: all })

    // migrate (propriétaire) pose la colonne et prend les fichiers présents pour référence.
    const out = await run(process.execPath, [MIGRATE_BIN], { env: { ...process.env, DATABASE_URL: db.url } })
    assert.match(out.stdout, new RegExp(`Empreintes enregistrées comme référence \\(${all.length}\\)`))
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM schema_migrations WHERE checksum IS NULL')).rows[0].n, 0)
    // Colonne ajoutée après runtime-role.sql : le SELECT de table la couvre.
    assert.deepEqual(await verifySchema(runtime), { unchecked: [] })

    // Ligne écrite par une image antérieure (sans empreinte) : complétée au passage suivant.
    await owner.query('UPDATE schema_migrations SET checksum = NULL WHERE name = $1', [FILE])
    assert.deepEqual(await verifySchema(runtime), { unchecked: [FILE] })
    assert.deepEqual(await migrate(owner), { applied: [], backfilled: [FILE] })
    assert.deepEqual(await verifySchema(runtime), { unchecked: [] })
  } finally {
    if (runtime) await runtime.end()
    await owner.end(); db.stop()
  }
})
