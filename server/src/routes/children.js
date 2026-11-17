// Enfants de la famille de la session (NAR-135). Lecture : tous les membres ;
// écriture : owner et manager. La famille vient de l'adhésion de la session et
// chaque requête filtre sur elle : l'enfant d'une autre famille n'existe pas (404).
import { randomUUID } from 'node:crypto'
import { HttpError, audit, isUuid, text } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, requireOwnFamily } from '../families.js'
import { openField, sealField } from '../crypto-fields.js'

export const AVATAR_COLORS = ['orange', 'blue', 'violet', 'green', 'yellow']
export const MAX_CHILDREN = 20

const CREATE = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName'],
  properties: { firstName: { type: 'string', maxLength: 200 }, avatarColor: { type: 'string', enum: AVATAR_COLORS } }
}
const UPDATE = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: CREATE.properties
}
const firstName = (v) => text(v, { min: 1, max: 40, field: 'Prénom' })
const notFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const aad = (id) => `children:first_name:${id}`

export default async function childrenRoutes(app) {
  const { db, config } = app
  const seal = (id, name) => sealField(name, config.dataKey, aad(id))
  // Champ par champ : jamais la ligne (ni le chiffré) vers le navigateur.
  const serialize = (r) => ({ id: r.id, firstName: openField(r.first_name_enc, config.dataKey, aad(r.id)), avatarColor: r.avatar_color, createdAt: r.created_at })
  const childId = (req) => { if (!isUuid(req.params.id)) throw notFound(); return req.params.id }

  app.get('/', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows } = await db.query(
      'SELECT id, first_name_enc, avatar_color, created_at FROM children WHERE family_id = $1 ORDER BY created_at, id', [own.familyId])
    return rows.map(serialize)
  })

  app.post('/', { schema: { body: CREATE } }, async (req, reply) => {
    const name = firstName(req.body.firstName)
    const row = await withTransaction(db, async (conn) => {
      const own = await requireOwnFamily(conn, req, MANAGERS)
      // Plafond sous verrou : deux ajouts simultanés ne le dépassent pas.
      await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`children:${own.familyId}`])
      const { rows: [{ n }] } = await conn.query('SELECT count(*)::int AS n FROM children WHERE family_id = $1', [own.familyId])
      if (n >= MAX_CHILDREN) throw new HttpError(409, 'Nombre maximal d’enfants atteint.', 'too_many_children')
      const id = randomUUID()
      const color = req.body.avatarColor ?? AVATAR_COLORS[n % AVATAR_COLORS.length]
      const { rows: [created] } = await conn.query(
        `INSERT INTO children(id, family_id, first_name_enc, avatar_color) VALUES ($1, $2, $3, $4)
         RETURNING id, first_name_enc, avatar_color, created_at`, [id, own.familyId, seal(id, name), color])
      await audit(conn, req, 'child_added', id)
      return created
    })
    return reply.code(201).send(serialize(row))
  })

  app.patch('/:id', { schema: { body: UPDATE } }, async (req) => {
    const id = childId(req)
    const own = await requireOwnFamily(db, req, MANAGERS)
    const sets = [], values = [id, own.familyId]
    if (req.body.firstName !== undefined) { values.push(seal(id, firstName(req.body.firstName))); sets.push(`first_name_enc = $${values.length}`) }
    if (req.body.avatarColor !== undefined) { values.push(req.body.avatarColor); sets.push(`avatar_color = $${values.length}`) }
    const { rows: [row] } = await db.query(
      `UPDATE children SET ${sets.join(', ')} WHERE id = $1 AND family_id = $2 RETURNING id, first_name_enc, avatar_color, created_at`, values)
    if (!row) throw notFound()
    await audit(db, req, 'child_updated', id)
    return serialize(row)
  })

  app.delete('/:id', async (req) => {
    const id = childId(req)
    const own = await requireOwnFamily(db, req, MANAGERS)
    const { rows } = await db.query('DELETE FROM children WHERE id = $1 AND family_id = $2 RETURNING id', [id, own.familyId])
    if (!rows[0]) throw notFound()
    await audit(db, req, 'child_removed', id)
    return { ok: true }
  })
}
