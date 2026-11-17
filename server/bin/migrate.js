// Administrative one-shot; never mount the administrator credential in the app.
import { createPool, migrate } from '../src/db.js'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis')
const pool = createPool(process.env.DATABASE_URL)
try { await migrate(pool); console.log('Migrations appliquées') } finally { await pool.end() }
