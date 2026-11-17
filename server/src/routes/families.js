// Familles : création par le parent principal (qui en devient owner), lecture
// par tous ses membres, renommage par owner/manager. Règles : CLAUDE.md,
// « Ressources : propriétaire et règle par opération ».
import { HttpError, audit, text } from '../lib.js'
import { MANAGERS, ROLES, notFound, requireOwnFamily, roleDenied } from '../families.js'

// Le schéma ne fait que borner l'entrée brute ; la règle (1 à 80 caractères
// après retrait des espaces) est celle de text(), comme char_length en base.
const NAME = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', maxLength: 200 } }
}
const familyName = (v) => text(v, { min: 1, max: 80, field: 'Nom de la famille' })

export default async function familiesRoutes(app) {
  const { db } = app

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
}
