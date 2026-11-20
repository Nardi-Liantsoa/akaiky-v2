// Application native (Capacitor) : la WebView a pour origine https://localhost
// ou capacitor://localhost, le cookie de l'API y serait un cookie tiers bloqué.
// Elle reçoit donc deux jetons opaques, stockés hachés dans la même table de
// sessions que le web :
//   - un jeton d'accès court (15 min), envoyé en `Authorization: Bearer` ;
//   - un jeton de renouvellement, tourné à chaque usage. Sur un réseau mobile,
//     la réponse se perd ou l'app est tuée avant d'avoir rangé le nouveau jeton,
//     et elle repasse l'ancien. Celui-ci est donc accepté UNE fois de plus, dans
//     les 7 jours qui suivent sa rotation et tant que son successeur n'a jamais
//     servi. Le successeur ainsi écarté est mémorisé : si quelqu'un le présente
//     ensuite, l'ancien jeton avait été volé et réutilisé à la place de l'app —
//     rejeu détecté, session de l'appareil fermée et signalée.
// L'app garde le jeton de renouvellement dans le Keychain / Keystore, le jeton
// d'accès en mémoire, et sérialise ses renouvellements (un seul à la fois).
import { HttpError, audit, me, isUuid, SESSION_RULE, body } from './lib.js'
import { newToken, tokenHash } from './security.js'
import { securityAlert } from './login-guard.js'

const PUBLIC = { config: { public: true } }
// Durée de vie maximale d'une session d'appareil, renouvellements compris.
const ABSOLUTE_DAYS = 180
// Délai pendant lequel l'ancien jeton peut encore servir une fois (app rouverte plus tard).
const PREVIOUS_DAYS = 7
const refreshTokenOf = (b) => typeof b?.refreshToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(b.refreshToken) ? b.refreshToken : null

export async function nativeRoutes(app, { limit, checkCredentials }) {
  const { db, config } = app
  const tokens = (access, refresh) => ({
    accessToken: access, refreshToken: refresh, expiresIn: config.native.accessMinutes * 60
  })
  const label = (b) => typeof b.device === 'string' ? b.device.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 60) : null

  app.post('/native/login', PUBLIC, async (req) => {
    limit(req)
    // Liste fermée (NAR-136 y ajoute `phone`) : un champ inconnu est un 400.
    const b = body(req, ['email', 'phone', 'password', 'device'])
    return checkCredentials(req, b, null, async (conn, user, needsMfa) => {
      // Les comptes à double authentification (admins) passent par la version
      // web : le défi MFA repose sur un cookie que la WebView n'enverrait pas.
      if (needsMfa) throw new HttpError(403, 'Ce compte se connecte depuis la version web (double authentification).', 'web_only')
      const access = newToken(), refresh = newToken()
      await conn.query(
        `INSERT INTO sessions(token_hash, user_id, kind, expires_at, refresh_hash, refresh_expires_at, label)
         VALUES ($1, $2, 'bearer', now() + make_interval(mins => $3), $4, now() + make_interval(days => $5), $6)`,
        [access.hash, user.id, config.native.accessMinutes, refresh.hash, config.native.refreshDays, label(b)])
      await audit(conn, req, 'login_native', user.id)
      return { user: me(user), ...tokens(access.token, refresh.token) }
    })
  })

  // Pas de limite par IP ici : derrière le NAT d'un opérateur mobile, des
  // centaines d'utilisateurs partagent une adresse et renouvellent toutes les
  // 15 minutes. Un jeton de 256 bits ne se devine pas ; le limiteur global de
  // l'API (par IP, par minute) reste en place.
  app.post('/native/refresh', PUBLIC, async (req) => {
    const given = refreshTokenOf(req.body)
    if (!given) throw new HttpError(401, 'Session expirée.')
    const hash = tokenHash(given)
    const access = newToken(), refresh = newToken()
    // Rotation atomique : un seul UPDATE consomme le jeton. Le compte doit
    // remplir la même règle que dans le hook de session (SESSION_RULE).
    // Réutilisation de l'ancien jeton : il est consommé (previous effacé, pas
    // de deuxième fois), le successeur inutilisé est écarté et mémorisé.
    const { rows } = await db.query(
      `UPDATE sessions s SET token_hash = $2, expires_at = now() + make_interval(mins => $4),
              refresh_hash = $3, last_seen_at = now(),
              previous_refresh_hash = CASE WHEN s.refresh_hash = $1 THEN s.refresh_hash END,
              discarded_refresh_hash = CASE WHEN s.refresh_hash = $1 THEN s.discarded_refresh_hash ELSE s.refresh_hash END,
              rotated_at = CASE WHEN s.refresh_hash = $1 THEN now() ELSE s.rotated_at END,
              refresh_expires_at = LEAST(now() + make_interval(days => $5), s.created_at + make_interval(days => $6))
         FROM users u
        WHERE s.kind = 'bearer' AND s.refresh_expires_at > now()
          AND (s.refresh_hash = $1 OR (s.previous_refresh_hash = $1 AND s.rotated_at > now() - make_interval(days => $7)))
          AND u.id = s.user_id AND ${SESSION_RULE}
        RETURNING u.id, u.email, u.phone, u.name, u.is_admin`,
      [hash, access.hash, refresh.hash, config.native.accessMinutes, config.native.refreshDays, ABSOLUTE_DAYS, PREVIOUS_DAYS])
    if (rows[0]) return { user: me(rows[0]), ...tokens(access.token, refresh.token) }
    // Jeton écarté par une réutilisation de son prédécesseur : deux détenteurs
    // pour une session. On la ferme et on le signale.
    const replayed = (await db.query(
      `DELETE FROM sessions WHERE kind = 'bearer' AND discarded_refresh_hash = $1 RETURNING user_id`, [hash])).rows[0]
    if (replayed) {
      await audit(db, req, 'refresh_replay', replayed.user_id)
      await securityAlert(db, 'refresh_replay')
    }
    throw new HttpError(401, 'Session expirée.')
  })

  // Déconnexion de l'app : par le jeton de renouvellement, qui reste valable
  // quand le jeton d'accès a expiré. Réponse identique que la session existe ou non.
  app.post('/native/logout', PUBLIC, async (req) => {
    const given = refreshTokenOf(req.body)
    if (given) {
      const hash = tokenHash(given)
      const gone = (await db.query(
        `DELETE FROM sessions WHERE kind = 'bearer' AND (refresh_hash = $1 OR previous_refresh_hash = $1 OR discarded_refresh_hash = $1)
         RETURNING user_id`, [hash])).rows[0]
      if (gone) await audit(db, req, 'logout_native', gone.user_id)
    }
    return { ok: true }
  })

  // Appareils connectés à l'application native, et révocation depuis l'espace
  // sécurité (web ou app) : hors de /native/, donc accessibles avec le cookie.
  app.get('/app-sessions', async (req) => {
    const user = app.requireUser(req)
    const { rows } = await db.query(
      `SELECT id, label, created_at, last_seen_at, token_hash = $2 AS current FROM sessions
        WHERE user_id = $1 AND kind = 'bearer' AND refresh_expires_at > now() ORDER BY last_seen_at DESC`,
      [user.id, req.sessionHash])
    return rows
  })

  app.delete('/app-sessions/:id', async (req) => {
    const user = app.requireUser(req)
    if (!isUuid(req.params.id)) throw new HttpError(404, 'Appareil introuvable.')
    const { rowCount } = await db.query(`DELETE FROM sessions WHERE id = $1 AND user_id = $2 AND kind = 'bearer'`, [req.params.id, user.id])
    if (!rowCount) throw new HttpError(404, 'Appareil introuvable.')
    await audit(db, req, 'native_session_revoked', user.id)
    return { ok: true }
  })
}
