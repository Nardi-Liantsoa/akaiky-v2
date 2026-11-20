// Administrative one-shot; never mount the administrator credential in the app.
// Compte propriétaire : joue les migrations en attente et enregistre l'empreinte des
// migrations déjà appliquées qui n'en ont pas (premier passage après NAR-198).
import { createPool, migrate } from '../src/db.js'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis')
const pool = createPool(process.env.DATABASE_URL)
try {
  const { applied, backfilled } = await migrate(pool)
  if (backfilled.length) console.log(`Empreintes enregistrées comme référence (${backfilled.length}) : ${backfilled.join(', ')}`)
  console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Aucune migration en attente')
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally { await pool.end() }
