import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 })
}

const MIGRATIONS = new URL('./migrations/', import.meta.url)
const MIGRATION_FILE = /^\d+_.+\.sql$/

// Empreinte SHA-256 d'une migration. Fins de ligne normalisées (CRLF → LF) avant
// le calcul : une copie Windows (core.autocrlf) du même fichier a la même empreinte.
// Le SQL exécuté, lui, reste le fichier tel quel.
export function migrationChecksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

async function readMigrations(dir) {
  const names = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort()
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(name, dir), 'utf8')
    return { name, sql, checksum: migrationChecksum(sql) }
  }))
}

// Migration publiée modifiée après application : erreur définitive (pas de nouvel essai).
export class MigrationDriftError extends Error {
  constructor(drifted) {
    super(drifted.map((d) => `Migration ${d.name} modifiée après application `
      + `(empreinte enregistrée ${d.stored.slice(0, 12)}…, fichier ${d.actual.slice(0, 12)}…).`).join('\n')
      + '\nUne migration publiée ne se modifie jamais : remettre le fichier tel qu\'il a été appliqué '
      + 'et écrire la correction dans une nouvelle migration numérotée. '
      + 'Base de développement : appliquer l\'écart à la main puis effacer l\'empreinte '
      + '(UPDATE schema_migrations SET checksum = NULL WHERE name = \'…\'), ou recréer la base ; '
      + 'voir HANDOFF.md « Migrations figées ».')
    this.name = 'MigrationDriftError'
    this.code = 'MIGRATION_DRIFT'
    this.files = drifted.map((d) => d.name)
  }
}

// Compare les fichiers aux lignes de schema_migrations (lues par SELECT * : la colonne
// checksum peut ne pas exister encore sur une base que migrate n'a pas revue).
// Une ligne sans fichier est ignorée : l'image précédente (retour arrière) n'a pas
// les migrations plus récentes.
function compare(files, rows) {
  const stored = new Map(rows.map((r) => [r.name, r.checksum ?? null]))
  const drifted = [], unchecked = [], pending = []
  for (const f of files) {
    if (!stored.has(f.name)) pending.push(f)
    else if (stored.get(f.name) === null) unchecked.push(f)
    else if (stored.get(f.name) !== f.checksum) drifted.push({ name: f.name, stored: stored.get(f.name), actual: f.checksum })
  }
  return { drifted, unchecked, pending }
}

// Migrations SQL numérotées, appliquées une seule fois, dans une transaction et
// sous verrou consultatif : deux conteneurs qui démarrent ensemble ne peuvent
// pas les jouer deux fois. Idempotent (contrat NosyHost).
// Chaque migration appliquée garde son empreinte (NAR-198) : un fichier modifié après
// application arrête tout, avant la moindre nouvelle migration. Confiance au premier
// usage : une ligne sans empreinte (base antérieure à NAR-198, ou écrite par une image
// plus ancienne) reçoit celle du fichier présent, qui devient la référence.
export async function migrate(pool, { dir = MIGRATIONS } = {}) {
  const files = await readMigrations(dir)
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(40004000)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    // Colonne posée par le runner, pas par une migration numérotée : la table lui
    // appartient, et l'empreinte doit exister avant de jouer (et d'enregistrer) la
    // première migration en attente.
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text')
    const { drifted, unchecked, pending } = compare(files, (await client.query('SELECT name, checksum FROM schema_migrations')).rows)
    if (drifted.length) throw new MigrationDriftError(drifted)
    for (const f of unchecked) {
      await client.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1 AND checksum IS NULL', [f.name, f.checksum])
    }
    for (const f of pending) {
      await client.query('BEGIN')
      try {
        await client.query(f.sql)
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [f.name, f.checksum])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${f.name} en échec : ${e.message}`)
      }
    }
    return { applied: pending.map((f) => f.name), backfilled: unchecked.map((f) => f.name) }
  } finally {
    await client.query('SELECT pg_advisory_unlock(40004000)').catch(() => {})
    client.release()
  }
}

// Runtime mode: the application never needs DDL or a database administrator.
// Lecture seule (le rôle app_runtime n'a que SELECT sur schema_migrations) : une
// empreinte qui diffère refuse le démarrage ; une empreinte absente est acceptée et
// renvoyée dans `unchecked` (à journaliser) : seul migrate, avec le propriétaire, l'enregistre.
export async function verifySchema(pool, { dir = MIGRATIONS } = {}) {
  const files = await readMigrations(dir)
  const { drifted, unchecked, pending } = compare(files, (await pool.query('SELECT * FROM schema_migrations')).rows)
  if (drifted.length) throw new MigrationDriftError(drifted)
  if (pending.length) throw new Error('Migration administrative requise avant démarrage')
  const { rows: [r] } = await pool.query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user')
  if (!r || Object.values(r).some(Boolean)) throw new Error('Compte applicatif PostgreSQL trop privilégié')
  return { unchecked: unchecked.map((f) => f.name) }
}

// Transaction sur une connexion dédiée : COMMIT si fn réussit, ROLLBACK sinon,
// connexion rendue au pool dans tous les cas.
export async function withTransaction(pool, fn) {
  const conn = await pool.connect()
  try {
    await conn.query('BEGIN')
    const result = await fn(conn)
    await conn.query('COMMIT')
    return result
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {})
    throw e
  } finally { conn.release() }
}
