// Côté invité : aperçu et acceptation d'une invitation (NAR-134). Le jeton
// voyage dans le corps (jamais dans l'URL) ; il est à usage unique, lié à
// l'adresse invitée, et consommé dans une transaction verrouillée.
import { HttpError, audit } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS } from '../families.js'
import { createLimiter, tokenHash } from '../security.js'

const TOKEN = {
  type: 'object',
  additionalProperties: false,
  required: ['token'],
  properties: { token: { type: 'string', minLength: 20, maxLength: 100 } }
}
const invalid = () => new HttpError(400, 'Invitation invalide ou expirée.', 'invite_invalid')

export default async function invitationsRoutes(app) {
  const { db } = app
  const perUser = createLimiter({ max: 20, windowMs: 15 * 60 * 1000 })
  const limit = (user) => { if (!perUser(user.id)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.') }

  // Le nom de la famille n'est montré qu'au compte invité.
  app.post('/preview', { schema: { body: TOKEN } }, async (req) => {
    const user = app.requireUser(req)
    limit(user)
    // Mêmes conditions que l'acceptation, invitant toujours gestionnaire compris.
    const { rows: [inv] } = await db.query(
      `SELECT i.email, i.role, f.name FROM invitations i
         JOIN families f ON f.id = i.family_id
         JOIN memberships m ON m.family_id = i.family_id AND m.user_id = i.invited_by AND m.role = ANY($2::text[])
        WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`, [tokenHash(req.body.token), MANAGERS])
    if (!inv) throw invalid()
    if (inv.email !== user.email) return { forThisAccount: false }
    return { forThisAccount: true, familyName: inv.name, role: inv.role }
  })

  app.post('/accept', { schema: { body: TOKEN } }, async (req) => {
    const user = app.requireUser(req)
    limit(user)
    return withTransaction(db, async (conn) => {
      const { rows: [inv] } = await conn.query(
        `SELECT id, family_id, email, role, invited_by FROM invitations
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [tokenHash(req.body.token)])
      if (!inv) throw invalid()
      if (inv.email !== user.email) throw new HttpError(403, 'Cette invitation est destinée à une autre adresse.', 'invite_other_account')
      // L'invitant doit toujours pouvoir inviter : un gestionnaire retiré entre-temps annule son invitation.
      const { rows: [inviter] } = await conn.query(
        'SELECT 1 FROM memberships WHERE family_id = $1 AND user_id = $2 AND role = ANY($3::text[])', [inv.family_id, inv.invited_by, MANAGERS])
      if (!inviter) throw invalid()
      await conn.query('UPDATE invitations SET used_at = now() WHERE id = $1', [inv.id])
      try {
        await conn.query('INSERT INTO memberships(family_id, user_id, role) VALUES ($1, $2, $3)', [inv.family_id, user.id, inv.role])
      } catch (e) {
        if (e.code === '23505') throw new HttpError(409, 'Ce compte fait déjà partie d’une famille.', 'already_in_family')
        throw e
      }
      await audit(conn, req, 'invitation_accepted', inv.id, { role: inv.role })
      return { familyId: inv.family_id, role: inv.role }
    })
  })
}
