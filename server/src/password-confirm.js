// Confirmation du mot de passe de la session avant une action irréversible
// (suppression de la famille, du compte). Même garde que la connexion : un seul
// essai à la fois pour l'adresse, compteur d'échecs et délai croissant du compte
// (users.failed_logins / locked_until), file des hachages scrypt (security.js).
// Mot de passe juste : `action(conn)` dans une transaction qui verrouille
// l'utilisateur (même ordre que la connexion), refusée si le mot de passe a
// changé entre-temps. `lockFirst(conn)`, facultatif, prend ses verrous dans la
// transaction AVANT la ligne de l'utilisateur (ordre imposé par une autre route).
import { HttpError, audit } from './lib.js'
import { verifyPassword } from './security.js'
import { createLoginGuard, securityAlert } from './login-guard.js'

export const wrongPassword = () => new HttpError(400, 'Mot de passe incorrect.', 'wrong_password')

// Le format seul ; à contrôler APRÈS les droits (un refus de rôle ne dépend pas du corps).
export function passwordOf(body) {
  const p = body && typeof body === 'object' && !Array.isArray(body) ? body.password : undefined
  if (typeof p !== 'string' || !p || p.length > 200) throw new HttpError(400, 'Mot de passe requis.', 'password_required')
  return p
}

export function createPasswordConfirm(db) {
  const guard = createLoginGuard(db)
  return async function confirmPassword(req, password, action, { lockFirst } = {}) {
    const user = req.user
    if (!user) throw new HttpError(401, 'Connexion requise.')
    // Garde du compte par son identifiant : adresse, ou numéro d'un compte sans adresse (NAR-136).
    return guard(user.email ?? user.phone, async (conn, g) => {
      const u = (await conn.query('SELECT password_hash FROM users WHERE id = $1', [user.id])).rows[0]
      // 400 et non 401 : un 401 voudrait dire « session perdue » (le client natif renouvellerait et renverrait).
      if (!u || !await verifyPassword(password, u.password_hash)) {
        const failures = await g.failed()
        if (failures >= 10) await securityAlert(conn, 'login_attack')
        await audit(conn, req, 'password_confirm_failed', user.id)
        throw wrongPassword()
      }
      await g.succeeded()
      await conn.query('BEGIN')
      try {
        if (lockFirst) await lockFirst(conn)
        const current = (await conn.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [user.id])).rows[0]
        if (!current || current.password_hash !== u.password_hash) throw wrongPassword()
        const result = await action(conn)
        await conn.query('COMMIT')
        return result
      } catch (e) { await conn.query('ROLLBACK'); throw e }
    })
  }
}
