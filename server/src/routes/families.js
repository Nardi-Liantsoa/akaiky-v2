// Familles : création par le parent principal (qui en devient owner), lecture
// par tous ses membres, renommage par owner/manager. Règles : CLAUDE.md,
// « Ressources : propriétaire et règle par opération ».
import { HttpError, audit, isUuid, text } from '../lib.js'
import { MANAGERS, ROLES, notFound, requireOwnFamily, roleDenied } from '../families.js'
import { createLimiter, newToken } from '../security.js'
import { authEmails } from '../mailer.js'
import { consumeQuota } from '../quotas.js'
import { email as normalizeEmail } from './auth.js'

// Le schéma ne fait que borner l'entrée brute ; la règle (1 à 80 caractères
// après retrait des espaces) est celle de text(), comme char_length en base.
const NAME = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', maxLength: 200 } }
}
const familyName = (v) => text(v, { min: 1, max: 80, field: 'Nom de la famille' })

const INVITE = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'role'],
  // Jamais owner : on devient parent principal par promotion, pas par invitation.
  properties: { email: { type: 'string', maxLength: 254 }, role: { type: 'string', enum: ['manager', 'member'] } }
}
const ROLE_BODY = {
  type: 'object',
  additionalProperties: false,
  required: ['role'],
  properties: { role: { type: 'string', enum: ROLES } }
}
export const INVITE_DAYS = 7
export const MAX_PENDING_INVITATIONS = 10
const memberNotFound = () => new HttpError(404, 'Membre introuvable.', 'member_not_found')
const lastOwner = () => new HttpError(409, 'La famille doit garder au moins un parent principal.', 'last_owner')

export default async function familiesRoutes(app) {
  const { db, config, mailer } = app
  const emails = authEmails(config.appName)
  const invitesPerUser = createLimiter({ max: 20, windowMs: 60 * 60 * 1000 })
  // Le jeton voyage dans le fragment ; l'origine vient de la configuration.
  const inviteLink = (token) => `${config.origin}/invitation#invite=${token}`

  async function transaction(fn) {
    const conn = await db.connect()
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

  // Adhésions de la famille verrouillées jusqu'à la fin de la transaction :
  // deux changements de rôle simultanés ne peuvent pas retirer le dernier owner.
  async function lockedMembers(conn, req, roles) {
    const own = await requireOwnFamily(conn, req, ROLES)
    const { rows } = await conn.query('SELECT user_id, role FROM memberships WHERE family_id = $1 ORDER BY user_id FOR UPDATE', [own.familyId])
    const actor = rows.find((r) => r.user_id === req.user.id)
    if (!actor) throw notFound()
    if (!roles.includes(actor.role)) throw roleDenied()
    return { familyId: own.familyId, actor, members: rows, owners: rows.filter((r) => r.role === 'owner').length }
  }

  app.post('/', { schema: { body: NAME } }, async (req, reply) => {
    const user = app.requireUser(req)
    const name = familyName(req.body.name)
    const conn = await db.connect()
    try {
      await conn.query('BEGIN')
      const { rows: [family] } = await conn.query('INSERT INTO families(name) VALUES ($1) RETURNING id, name', [name])
      // L'unicité de memberships.user_id tranche deux créations simultanées.
      await conn.query("INSERT INTO memberships(family_id, user_id, role) VALUES ($1, $2, 'owner')", [family.id, user.id])
      await audit(conn, req, 'family_created', family.id)
      await conn.query('COMMIT')
      return reply.code(201).send({ id: family.id, name: family.name, role: 'owner' })
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => {})
      if (e.code === '23505') throw new HttpError(409, 'Ce compte a déjà une famille.', 'family_exists')
      throw e
    } finally { conn.release() }
  })

  // Une seule requête : famille, rôle de l'appelant et membres, lus ensemble
  // (une famille supprimée entre deux lectures ne peut pas donner un 500).
  app.get('/me', async (req) => {
    const user = app.requireUser(req)
    const { rows } = await db.query(
      `SELECT f.id, f.name, me.role AS my_role, m.user_id, m.role, u.name AS member_name
         FROM memberships me
         JOIN families f ON f.id = me.family_id
         JOIN memberships m ON m.family_id = f.id
         JOIN users u ON u.id = m.user_id
        WHERE me.user_id = $1
        ORDER BY array_position($2::text[], m.role), m.created_at`,
      [user.id, ROLES])
    if (!rows[0]) throw notFound()
    return {
      id: rows[0].id,
      name: rows[0].name,
      role: rows[0].my_role,
      members: rows.map((r) => ({ userId: r.user_id, name: r.member_name, role: r.role, isMe: r.user_id === user.id }))
    }
  })

  // Rôle vérifié DANS l'UPDATE (un gestionnaire rétrogradé entre-temps ne renomme pas) ;
  // si rien n'est modifié, l'adhésion relue dit pourquoi : plus membre → 404, rôle → 403.
  app.patch('/me', { schema: { body: NAME } }, async (req) => {
    const user = app.requireUser(req)
    const name = familyName(req.body.name)
    const conn = await db.connect()
    try {
      await conn.query('BEGIN')
      const { rows: [row] } = await conn.query(
        `UPDATE families f SET name = $1 FROM memberships m
          WHERE m.user_id = $2 AND m.family_id = f.id AND m.role = ANY($3::text[])
          RETURNING f.id, f.name, m.role`, [name, user.id, MANAGERS])
      if (!row) {
        await requireOwnFamily(conn, req, MANAGERS) // plus membre → 404, rôle insuffisant → 403
        throw roleDenied()
      }
      await audit(conn, req, 'family_renamed', row.id)
      await conn.query('COMMIT')
      return { id: row.id, name: row.name, role: row.role }
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => {})
      throw e
    } finally { conn.release() }
  })

  // --- Invitations (owner, manager) ---

  app.get('/me/invitations', async (req) => {
    const own = await requireOwnFamily(db, req, MANAGERS)
    const { rows } = await db.query(
      `SELECT id, email, role, created_at, expires_at FROM invitations
        WHERE family_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [own.familyId])
    return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }))
  })

  app.post('/me/invitations', { schema: { body: INVITE } }, async (req, reply) => {
    const user = app.requireUser(req)
    await requireOwnFamily(db, req, MANAGERS)
    const invitee = normalizeEmail(req.body.email)
    if (!invitesPerUser(user.id)) throw new HttpError(429, 'Trop d’invitations envoyées. Réessayez plus tard.')
    await consumeQuota(db, 'auth-emails', config.quotas.authEmailsPerHour)
    const { token, hash } = newToken()
    const invitation = await transaction(async (conn) => {
      const own = await requireOwnFamily(conn, req, MANAGERS)
      await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`invitations:${own.familyId}`])
      const { rows: [member] } = await conn.query(
        'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.family_id = $1 AND u.email = $2', [own.familyId, invitee])
      if (member) throw new HttpError(409, 'Cette personne fait déjà partie de la famille.', 'already_member')
      // Une nouvelle invitation remplace la précédente pour la même adresse.
      await conn.query('DELETE FROM invitations WHERE family_id = $1 AND email = $2 AND used_at IS NULL', [own.familyId, invitee])
      const { rows: [{ n }] } = await conn.query(
        'SELECT count(*)::int AS n FROM invitations WHERE family_id = $1 AND used_at IS NULL AND expires_at > now()', [own.familyId])
      if (n >= MAX_PENDING_INVITATIONS) throw new HttpError(409, 'Trop d’invitations en attente. Annulez-en une d’abord.', 'too_many_invitations')
      const { rows: [row] } = await conn.query(
        `INSERT INTO invitations(family_id, email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
         RETURNING id, email, role, created_at, expires_at`,
        [own.familyId, invitee, req.body.role, hash, user.id, INVITE_DAYS])
      await audit(conn, req, 'invitation_created', row.id, { role: row.role })
      return row
    })
    try {
      await mailer.send({ to: invitee, ...emails.invitation(inviteLink(token)) })
    } catch (e) {
      req.log.error({ err: e }, 'Envoi d’une invitation impossible')
      await db.query('DELETE FROM invitations WHERE id = $1', [invitation.id])
      throw new HttpError(503, 'Envoi de l’invitation impossible. Réessayez dans un moment.')
    }
    return reply.code(201).send({
      id: invitation.id, email: invitation.email, role: invitation.role, createdAt: invitation.created_at, expiresAt: invitation.expires_at
    })
  })

  app.delete('/me/invitations/:id', async (req) => {
    const own = await requireOwnFamily(db, req, MANAGERS)
    if (!isUuid(req.params.id)) throw new HttpError(404, 'Invitation introuvable.', 'invitation_not_found')
    const { rows } = await db.query(
      'DELETE FROM invitations WHERE id = $1 AND family_id = $2 AND used_at IS NULL RETURNING id', [req.params.id, own.familyId])
    if (!rows[0]) throw new HttpError(404, 'Invitation introuvable.', 'invitation_not_found')
    await audit(db, req, 'invitation_cancelled', rows[0].id)
    return { ok: true }
  })

  // --- Membres ---
  // owner : tout rôle ; manager : entre manager et member, jamais un owner ;
  // le dernier owner n'est ni rétrogradé ni retiré.

  app.patch('/me/members/:userId', { schema: { body: ROLE_BODY } }, async (req) => {
    app.requireUser(req)
    if (!isUuid(req.params.userId)) throw memberNotFound()
    const role = req.body.role
    return transaction(async (conn) => {
      const { familyId, actor, members, owners } = await lockedMembers(conn, req, MANAGERS)
      const target = members.find((m) => m.user_id === req.params.userId)
      if (!target) throw memberNotFound()
      if (actor.role !== 'owner' && (target.role === 'owner' || role === 'owner')) throw roleDenied()
      if (target.role === 'owner' && role !== 'owner' && owners === 1) throw lastOwner()
      if (target.role !== role) {
        await conn.query('UPDATE memberships SET role = $1 WHERE family_id = $2 AND user_id = $3', [role, familyId, target.user_id])
        await audit(conn, req, 'member_role_changed', target.user_id, { from: target.role, to: role })
      }
      return { userId: target.user_id, role }
    })
  })

  app.delete('/me/members/:userId', async (req) => {
    const user = app.requireUser(req)
    if (!isUuid(req.params.userId)) throw memberNotFound()
    const leaving = req.params.userId === user.id
    return transaction(async (conn) => {
      // Chacun peut partir ; retirer quelqu'un d'autre est réservé aux gestionnaires.
      const { familyId, actor, members, owners } = await lockedMembers(conn, req, leaving ? ROLES : MANAGERS)
      const target = members.find((m) => m.user_id === req.params.userId)
      if (!target) throw memberNotFound()
      if (!leaving && actor.role !== 'owner' && target.role === 'owner') throw roleDenied()
      if (target.role === 'owner' && owners === 1) throw lastOwner()
      await conn.query('DELETE FROM memberships WHERE family_id = $1 AND user_id = $2', [familyId, target.user_id])
      await audit(conn, req, leaving ? 'member_left' : 'member_removed', target.user_id)
      return { ok: true }
    })
  })
}
