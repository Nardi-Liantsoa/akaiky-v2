// Données de DÉVELOPPEMENT LOCAL : deux comptes confirmés aux identifiants
// connus. Relançable. Refuse de s'exécuter en production.
//   npm run dev:seed   (depuis la racine du dépôt)
import { createPool, migrate } from '../src/db.js'
import { hashPassword } from '../src/security.js'

if (process.env.NODE_ENV === 'production') { console.error('refusé : NODE_ENV=production'); process.exit(1) }
const db = createPool(process.env.DATABASE_URL)
await migrate(db)

// L'admin local n'a pas de MFA : la connexion lui demandera d'activer le
// second facteur avec une invitation (npm run mfa-invite, voir README).
const accounts = [
  { email: 'admin@local.test', name: 'Admin (local)', password: 'admin-local-mot-de-passe', admin: true },
  { email: 'alice@local.test', name: 'Alice', password: 'alice-local-mot-de-passe' },
  { email: 'bob@local.test', name: 'Bob', password: 'bob-local-mot-de-passe' }
]
for (const a of accounts) {
  await db.query(
    `INSERT INTO users(email, name, password_hash, is_admin, email_verified_at, consent_at) VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
       is_admin = EXCLUDED.is_admin, failed_logins = 0, locked_until = NULL,
       consent_at = COALESCE(users.consent_at, EXCLUDED.consent_at)`,
    [a.email, a.name, await hashPassword(a.password), !!a.admin])
}
console.log('\nComptes (base locale uniquement) :')
for (const a of accounts) console.log(`  ${a.admin ? 'admin' : 'user '}  ${a.email.padEnd(20)} / ${a.password}`)
await db.end()
