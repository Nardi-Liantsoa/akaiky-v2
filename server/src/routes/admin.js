// Administration : réservée aux comptes `users.is_admin`, posé uniquement par
// `bin/make-admin.js` (aucune route ne le modifie, et le rôle SQL de
// l'application n'a pas le droit UPDATE sur cette colonne). La MFA est
// obligatoire pour ces comptes : sans second facteur vérifié, pas de session.
const ADMIN = { config: { admin: true } }

export default async function adminRoutes(app) {
  const { db } = app

  app.get('/users', ADMIN, async (req) => {
    app.requireAdmin(req)
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at, u.email_verified_at,
              EXISTS (SELECT 1 FROM mfa_factors f WHERE f.user_id = u.id) AS mfa
         FROM users u ORDER BY u.created_at DESC LIMIT 500`)
    return rows
  })

  app.get('/audit', ADMIN, async (req) => {
    app.requireAdmin(req)
    const { rows } = await db.query(
      `SELECT a.at, a.action, a.target, a.ip, a.details, u.email AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC LIMIT 300`)
    return rows
  })
}
