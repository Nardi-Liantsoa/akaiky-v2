// Donne (ou retire) le rôle d'administrateur à un compte existant.
// Volontairement hors du web : aucune route HTTP ne peut créer un admin.
//
//   Avec DATABASE_URL du propriétaire SQL : node bin/make-admin.js vous@exemple.fr
//   Avec DATABASE_URL du propriétaire SQL : node bin/make-admin.js vous@exemple.fr --retirer
import { createPool } from '../src/db.js'

const [email, flag] = process.argv.slice(2)
if (!email) { console.error('usage : node bin/make-admin.js <email> [--retirer]'); process.exit(1) }
const db = createPool(process.env.DATABASE_URL)
const admin = flag !== '--retirer'
const conn = await db.connect()
try {
await conn.query('BEGIN')
const { rows } = await conn.query('UPDATE users SET is_admin = $2 WHERE email = $1 RETURNING id, email, is_admin, email_verified_at', [email.toLowerCase(), admin])
if (!rows[0]) throw new Error('Compte inexistant : inscription préalable requise')
await conn.query('DELETE FROM sessions WHERE user_id=$1', [rows[0].id])
await conn.query('DELETE FROM trusted_devices WHERE user_id=$1', [rows[0].id])
await conn.query('DELETE FROM mfa_challenges WHERE user_id=$1', [rows[0].id])
await conn.query('INSERT INTO audit_log(action, target, details) VALUES ($1, $2, $3)', [admin ? 'admin_granted' : 'admin_revoked', rows[0].email, { via: 'cli' }])
await conn.query('COMMIT')
console.log(`${rows[0].email} : administrateur = ${rows[0].is_admin}${rows[0].email_verified_at ? '' : ' (adresse pas encore confirmée)'}`)
} catch(error) { await conn.query('ROLLBACK'); throw error } finally {conn.release(); await db.end()}
