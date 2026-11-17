// Familles : création par le parent principal (qui en devient owner), lecture
// par tous ses membres, renommage par owner/manager. Règles : CLAUDE.md,
// « Ressources : propriétaire et règle par opération ».
import { HttpError, audit, text } from '../lib.js'
import { MANAGERS, ROLES, requireOwnFamily } from '../families.js'

const NAME = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 80 } }
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

  app.get('/me', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [family] } = await db.query('SELECT id, name FROM families WHERE id = $1', [own.familyId])
    const { rows } = await db.query(
      `SELECT m.user_id, m.role, u.name FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.family_id = $1 ORDER BY array_position($2::text[], m.role), m.created_at`,
      [own.familyId, ROLES])
    return {
      id: family.id,
      name: family.name,
      role: own.role,
      members: rows.map((r) => ({ userId: r.user_id, name: r.name, role: r.role, isMe: r.user_id === req.user.id }))
    }
  })

  app.patch('/me', { schema: { body: NAME } }, async (req) => {
    const own = await requireOwnFamily(db, req, MANAGERS)
    const name = familyName(req.body.name)
    const { rows: [family] } = await db.query('UPDATE families SET name = $1 WHERE id = $2 RETURNING id, name', [name, own.familyId])
    await audit(db, req, 'family_renamed', family.id)
    return { id: family.id, name: family.name, role: own.role }
  })
}
