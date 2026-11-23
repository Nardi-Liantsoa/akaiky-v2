// Administration : réservée aux comptes `users.is_admin`, posé uniquement par
// `bin/make-admin.js` (aucune route ne le modifie, et le rôle SQL de
// l'application n'a pas le droit UPDATE sur cette colonne). La MFA est
// obligatoire pour ces comptes : sans second facteur vérifié, pas de session.
//
// Back-office (NAR-144, CdC §6) : familles, téléphones, derniers signaux et
// statistiques anonymes, SANS positions, journaux d'appels, prénoms ni numéros.
// Chaque requête nomme ses colonnes une à une : jamais `SELECT *`, jamais une
// colonne chiffrée (`*_enc`), un hachage, un jeton ni le nom libre d'une famille
// (texte choisi par la famille, qui peut contenir le prénom d'un enfant : la
// famille est désignée par son identifiant). Test : server/test/admin.test.js.
//
// Tranche 2 (NAR-199) : désactiver ou réactiver un compte, révoquer un téléphone. Chaque
// écriture est auditée, refuse tout paramètre ou champ de corps et ne rend que { ok }.
// Tests : server/test/admin-actions.test.js.
import { HttpError, audit, body, isUuid } from '../lib.js'
import { SILENT_MINUTES } from '../device-status.js'
import { withTransaction } from '../db.js'
import { isLastAdmin, lockAdmins } from '../admins.js'
import { revokeDevice } from './devices.js'

const ADMIN = { config: { admin: true } }
export const ADMIN_PAGE_MAX = 100
const PAGE_DEFAULT = 50

// Pagination par curseur (date de création, id), du plus récent au plus ancien :
// `limit` (1 à 100) et `before` (`<date ISO>_<uuid>`, rendu dans `next`). Tout autre
// paramètre, ou une valeur mal formée, est un 400 (jamais ignoré en silence).
function page(query) {
  const unknown = Object.keys(query ?? {}).filter((k) => k !== 'limit' && k !== 'before')
  if (unknown.length) throw new HttpError(400, `Paramètre non accepté : ${unknown.join(', ')}`)
  let limit = PAGE_DEFAULT
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[0-9]{1,3}$/.test(query.limit)) throw new HttpError(400, 'Paramètre limit invalide.')
    limit = Number(query.limit)
    if (limit < 1 || limit > ADMIN_PAGE_MAX) throw new HttpError(400, `limit : 1 à ${ADMIN_PAGE_MAX}.`)
  }
  let cursor = null
  if (query.before !== undefined) {
    const [at, id, extra] = typeof query.before === 'string' && query.before.length <= 80 ? query.before.split('_') : []
    if (!validCursorDate(at) || extra !== undefined || !isUuid(id)) throw new HttpError(400, 'Paramètre before invalide.')
    // Passée en texte à PostgreSQL : la microseconde est gardée (un Date JS l'arrondirait
    // à la milliseconde, et les lignes créées dans la même milliseconde seraient sautées).
    cursor = [at, id]
  }
  return { limit, cursor }
}
// Date du curseur : ISO UTC stricte, jusqu'à la microseconde, et date réelle (un 30 février
// ou une année 0000 seraient acceptés par Date puis refusés par PostgreSQL : 500 au lieu de 400).
const CURSOR_DATE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,6})?Z$/
function validCursorDate(at) {
  const m = typeof at === 'string' && CURSOR_DATE.exec(at)
  if (!m) return false
  const d = new Date(`${m[1]}Z`)
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.toISOString().slice(0, 19) === m[1]
}
// Date de création à la microseconde, en UTC, pour le curseur `next`.
const CURSOR_AT = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at`
const nextOf = (rows, limit) => {
  const last = rows[limit - 1]
  return rows.length > limit && last ? `${last.cursor_at}_${last.id}` : null
}
const noQuery = (query) => {
  const keys = Object.keys(query ?? {})
  if (keys.length) throw new HttpError(400, `Paramètre non accepté : ${keys.join(', ')}`)
}
// Écritures de l'équipe : aucun champ attendu. Corps absent ou `{}` ; tout champ est un 400
// (jamais ignoré en silence), un corps qui n'est pas un objet aussi.
const noBody = (req) => { if (req.body !== undefined && req.body !== null) body(req, []) }
const userNotFound = () => new HttpError(404, 'Compte introuvable.', 'user_not_found')

// État d'un téléphone vu par l'équipe : révoqué ; silencieux (surveillé en arrière-plan,
// dernier signal plus vieux que le seuil de l'alerte « silence », même règle que jobs.js) ;
// sinon actif. Calculé sur child_devices seul : les alertes (device_alerts) restent à la famille.
const DEVICE_STATE_SQL = `CASE WHEN d.revoked_at IS NOT NULL THEN 'revoked'
  WHEN d.background_status AND d.status_at < now() - make_interval(mins => ${SILENT_MINUTES}) THEN 'silent'
  ELSE 'active' END`

export default async function adminRoutes(app) {
  const { db } = app

  app.get('/users', ADMIN, async (req) => {
    app.requireAdmin(req)
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at, u.email_verified_at,
              -- Compte à numéro (NAR-136) : le numéro ne sort jamais vers l'équipe (aucune clé « phone »
              -- dans une réponse admin) ; seulement le type d'identifiant et la confirmation.
              u.email IS NULL AS sms_account, (u.email_verified_at IS NOT NULL OR u.phone_verified_at IS NOT NULL) AS verified,
              u.disabled_at,
              EXISTS (SELECT 1 FROM mfa_factors f WHERE f.user_id = u.id) AS mfa
         FROM users u ORDER BY u.created_at DESC LIMIT 500`)
    return rows
  })

  // Désactivation d'un compte (NAR-199) : plus aucune session (SESSION_RULE refuse cookie,
  // Bearer et renouvellement natif d'un compte désactivé), sessions effacées tout de suite
  // (jetons push par cascade), défis MFA en cours aussi ; la connexion répond le 401 d'un
  // mauvais mot de passe. Jamais son propre compte (409 self_disable), jamais le dernier
  // administrateur actif (409 last_admin, même verrou que la suppression d'un compte).
  // Déjà désactivé : rien d'écrit ni d'audité.
  app.post('/users/:id/disable', ADMIN, async (req) => {
    const admin = app.requireAdmin(req)
    noQuery(req.query)
    noBody(req)
    if (!isUuid(req.params.id)) throw userNotFound()
    if (req.params.id.toLowerCase() === admin.id) throw new HttpError(409, 'Vous ne pouvez pas désactiver votre propre compte.', 'self_disable')
    await withTransaction(db, async (conn) => {
      // Ordre des verrous de la suppression d'un compte : la ligne du compte, puis le verrou
      // des administrateurs (jamais l'inverse : interblocage avec une suppression simultanée).
      const { rows: [user] } = await conn.query('SELECT id, is_admin, disabled_at FROM users WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!user) throw userNotFound()
      if (user.disabled_at) return
      if (user.is_admin) {
        await lockAdmins(conn)
        if (await isLastAdmin(conn, user.id)) throw new HttpError(409, 'Dernier administrateur actif : il ne peut pas être désactivé.', 'last_admin')
      }
      await conn.query('UPDATE users SET disabled_at = now() WHERE id = $1', [user.id])
      await conn.query('DELETE FROM sessions WHERE user_id = $1', [user.id])
      await conn.query('DELETE FROM mfa_challenges WHERE user_id = $1', [user.id])
      await audit(conn, req, 'account_disabled', user.id)
    })
    return { ok: true }
  })

  // Réactivation : le compte peut se reconnecter (aucune session rendue). Déjà actif : rien
  // d'écrit ni d'audité.
  app.post('/users/:id/enable', ADMIN, async (req) => {
    app.requireAdmin(req)
    noQuery(req.query)
    noBody(req)
    if (!isUuid(req.params.id)) throw userNotFound()
    await withTransaction(db, async (conn) => {
      const { rows: [user] } = await conn.query('SELECT id, disabled_at FROM users WHERE id = $1 FOR UPDATE', [req.params.id])
      if (!user) throw userNotFound()
      if (!user.disabled_at) return
      await conn.query('UPDATE users SET disabled_at = NULL WHERE id = $1', [user.id])
      await audit(conn, req, 'account_enabled', user.id)
    })
    return { ok: true }
  })

  // Révocation d'un téléphone par l'équipe (NAR-199) : la même que celle d'un gestionnaire
  // (revokeDevice, routes/devices.js), sans condition de famille. Sessions d'appareil, jeton
  // « signal de vie », jetons push et inventaire effacés, alertes fermées. Inconnu ou déjà
  // révoqué → 404.
  app.post('/devices/:id/revoke', ADMIN, async (req) => {
    app.requireAdmin(req)
    noQuery(req.query)
    noBody(req)
    if (!isUuid(req.params.id)) throw new HttpError(404, 'Téléphone introuvable.', 'device_not_found')
    await withTransaction(db, (conn) => revokeDevice(conn, req, req.params.id, { details: { by: 'admin' } }))
    return { ok: true }
  })

  // Enfants d'une famille vus par l'équipe (NAR-200) : de quoi viser une demande de nouveau
  // code parent, rien de plus. Identifiant, date, code défini ou non, demande en cours ; jamais
  // le prénom, le numéro, la couleur ni le hachage. 20 enfants au plus par famille : pas de page.
  app.get('/families/:id/children', ADMIN, async (req) => {
    app.requireAdmin(req)
    noQuery(req.query)
    const familyNotFound = () => new HttpError(404, 'Famille introuvable.', 'family_not_found')
    if (!isUuid(req.params.id)) throw familyNotFound()
    const { rows: [family] } = await db.query('SELECT id FROM families WHERE id = $1', [req.params.id])
    if (!family) throw familyNotFound()
    const { rows } = await db.query(
      `SELECT c.id, c.created_at, c.parent_code_hash IS NOT NULL AS parent_code_set, c.parent_code_reset_requested_at
         FROM children c WHERE c.family_id = $1 ORDER BY c.created_at, c.id`, [family.id])
    return rows.map((r) => ({
      // Clés sans « parentCode » : l'inspection des réponses admin (admin.test.js) refuse ce mot.
      id: r.id, createdAt: r.created_at, codeSet: r.parent_code_set, newCodeRequestedAt: r.parent_code_reset_requested_at
    }))
  })

  // Demande d'un nouveau code parent (NAR-200), après la vérification d'identité de HANDOFF.md.
  // Une date posée sur l'enfant, montrée aux gestionnaires, effacée par leur nouveau code : le
  // hachage n'est pas touché (l'ancien code déverrouille toujours, le déverrouillage à distance
  // aussi) et config_version n'avance pas (colonne hors du déclencheur). Aucune remise à zéro ne
  // déverrouille le téléphone. Sans code défini : 409 no_parent_code (rien à remplacer). Famille dont
  // aucun owner/manager actif n'a d'adresse confirmée (comptes par numéro, NAR-136) : 409 no_written_channel,
  // la demande écrite exigée par la vérification d'identité est impossible. Demande déjà en cours :
  // rien d'écrit ni d'audité.
  app.post('/children/:id/parent-code/reset', ADMIN, async (req) => {
    app.requireAdmin(req)
    noQuery(req.query)
    noBody(req)
    const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
    if (!isUuid(req.params.id)) throw childNotFound()
    await withTransaction(db, async (conn) => {
      const { rows: [kid] } = await conn.query(
        `SELECT id, family_id, parent_code_hash IS NOT NULL AS has_code, parent_code_reset_requested_at
           FROM children WHERE id = $1 FOR UPDATE`, [req.params.id])
      if (!kid) throw childNotFound()
      if (!kid.has_code) throw new HttpError(409, 'Aucun code parent défini : rien à remplacer.', 'no_parent_code')
      if (kid.parent_code_reset_requested_at) return
      const { rows: [channel] } = await conn.query(
        `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.family_id = $1 AND m.role IN ('owner', 'manager') AND u.email IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.disabled_at IS NULL LIMIT 1`,
        [kid.family_id])
      if (!channel) throw new HttpError(409, 'Aucun gestionnaire de la famille n’a d’adresse confirmée : la demande écrite est impossible.', 'no_written_channel')
      await conn.query('UPDATE children SET parent_code_reset_requested_at = now() WHERE id = $1', [kid.id])
      await audit(conn, req, 'parent_code_reset_requested', kid.id)
    })
    return { ok: true }
  })

  app.get('/audit', ADMIN, async (req) => {
    app.requireAdmin(req)
    const { rows } = await db.query(
      `SELECT a.at, a.action, a.target, a.ip, a.details, COALESCE(u.email::text, u.id::text) AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.at DESC LIMIT 300`)
    return rows
  })

  // Familles : identifiant, nombres de membres, d'enfants et de téléphones actifs, date.
  // Ni nom de famille, ni prénom, ni membre nommé.
  app.get('/families', ADMIN, async (req) => {
    app.requireAdmin(req)
    const { limit, cursor } = page(req.query)
    const { rows } = await db.query(
      `SELECT f.id, f.created_at, ${CURSOR_AT('f.created_at')},
              (SELECT count(*)::int FROM memberships m WHERE m.family_id = f.id) AS members,
              (SELECT count(*)::int FROM children c WHERE c.family_id = f.id) AS children,
              (SELECT count(*)::int FROM child_devices d WHERE d.family_id = f.id AND d.revoked_at IS NULL) AS devices
         FROM families f
        WHERE ($1::timestamptz IS NULL OR (f.created_at, f.id) < ($1::timestamptz, $2::uuid))
        ORDER BY f.created_at DESC, f.id DESC LIMIT $3`,
      [cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1])
    return {
      items: rows.slice(0, limit).map((r) => ({
        id: r.id, members: r.members, children: r.children, devices: r.devices, createdAt: r.created_at
      })),
      next: nextOf(rows, limit)
    }
  })

  // Téléphones : modèle, versions, derniers signaux, état. Ni enfant, ni numéro, ni position,
  // ni batterie : l'équipe voit si un téléphone vit, pas ce qu'il fait.
  app.get('/devices', ADMIN, async (req) => {
    app.requireAdmin(req)
    const { limit, cursor } = page(req.query)
    const { rows } = await db.query(
      `SELECT d.id, d.family_id, d.model, d.os_version, d.app_version, d.created_at, d.last_seen_at,
              d.status_at, d.revoked_at, ${DEVICE_STATE_SQL} AS state, ${CURSOR_AT('d.created_at')}
         FROM child_devices d
        WHERE ($1::timestamptz IS NULL OR (d.created_at, d.id) < ($1::timestamptz, $2::uuid))
        ORDER BY d.created_at DESC, d.id DESC LIMIT $3`,
      [cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1])
    return {
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        familyId: r.family_id,
        model: r.model,
        osVersion: r.os_version,
        appVersion: r.app_version,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        // Dernier signal de vie (POST /api/device/heartbeat) ; null tant qu'aucun.
        statusAt: r.status_at,
        revokedAt: r.revoked_at,
        state: r.state
      })),
      next: nextOf(rows, limit)
    }
  })

  // Statistiques anonymes : des nombres, jamais une ligne. SOS : aucune table encore
  // (NAR-181 enverra le journal du SOS au serveur) : 0, signalé par `sosTracked: false`.
  app.get('/stats', ADMIN, async (req) => {
    app.requireAdmin(req)
    noQuery(req.query)
    const { rows: [s] } = await db.query(
      `SELECT (SELECT count(*)::int FROM families) AS families,
              (SELECT count(*)::int FROM children) AS children,
              (SELECT count(*)::int FROM child_devices d WHERE d.revoked_at IS NULL) AS devices,
              (SELECT count(*)::int FROM child_devices d WHERE ${DEVICE_STATE_SQL} = 'active') AS active_devices,
              (SELECT count(*)::int FROM child_devices d WHERE ${DEVICE_STATE_SQL} = 'silent') AS silent_devices,
              (SELECT count(*)::int FROM child_devices d WHERE d.revoked_at IS NULL AND d.status_at > now() - interval '24 hours') AS signal_24h`)
    return {
      families: s.families,
      children: s.children,
      devices: s.devices,
      activeDevices: s.active_devices,
      silentDevices: s.silent_devices,
      devicesSignal24h: s.signal_24h,
      sosThisMonth: 0,
      sosTracked: false
    }
  })
}
