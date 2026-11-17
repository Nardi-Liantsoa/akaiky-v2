import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 15000, idle_in_transaction_session_timeout: 15000 })
}

// Migrations SQL numérotées, appliquées une seule fois, dans une transaction et
// sous verrou consultatif : deux conteneurs qui démarrent ensemble ne peuvent
// pas les jouer deux fois. Idempotent (contrat NosyHost).
export async function migrate(pool) {
  const dir = new URL('./migrations/', import.meta.url)
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(40004000)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
    for (const f of files) {
      if (done.has(f)) continue
      const sql = await readFile(new URL(f, dir), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${f} en échec : ${e.message}`)
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(40004000)').catch(() => {})
    client.release()
  }
}

// Runtime mode: the application never needs DDL or a database administrator.
export async function verifySchema(pool) {
  const files = (await readdir(new URL('./migrations/', import.meta.url))).filter(f => /^\d+_.+\.sql$/.test(f))
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(r => r.name))
  if (files.some(f => !done.has(f))) throw new Error('Migration administrative requise avant démarrage')
  const { rows: [r] } = await pool.query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user')
  if (!r || Object.values(r).some(Boolean)) throw new Error('Compte applicatif PostgreSQL trop privilégié')
}
