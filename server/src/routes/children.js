// Enfants de la famille de la session (NAR-135). Lecture : tous les membres ;
// écriture : owner et manager. La famille vient de l'adhésion de la session et
// chaque requête filtre sur elle : l'enfant d'une autre famille n'existe pas (404).
import { randomUUID } from 'node:crypto'
import { HttpError, audit, isUuid, text } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, lockOwnFamily, requireOwnFamily } from '../families.js'
import { openField, sealField } from '../crypto-fields.js'
import { hashParentCode, parentCodeProblem, reserveHashSlot } from '../parent-code.js'
import { createLimiter } from '../security.js'

export const AVATAR_COLORS = ['orange', 'blue', 'violet', 'green', 'yellow']

// Couleur par défaut : la moins portée parmi `used` (ordre de la liste à égalité).
export function leastUsedColor(used) {
  const count = (c) => used.filter((u) => u === c).length
  return AVATAR_COLORS.reduce((best, c) => (count(c) < count(best) ? c : best))
}
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
// Corps du code parent : la forme exacte est vérifiée ensuite, pour un refus précis.
const PARENT_CODE = {
  type: 'object',
  additionalProperties: false,
  required: ['code'],
  properties: { code: { type: 'string', maxLength: 20 } }
}
const COLUMNS = 'id, first_name_enc, avatar_color, created_at, parent_code_set_at'
const firstName = (v) => text(v, { min: 1, max: 40, field: 'Prénom' })
const notFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const aad = (id) => `children:first_name:${id}`

export default async function childrenRoutes(app) {
  const { db, config } = app
  const seal = (id, name) => sealField(name, config.dataKey, aad(id))
  // Champ par champ : jamais la ligne (ni le chiffré, ni le hachage du code parent) vers le navigateur.
  const serialize = (r) => ({
    id: r.id,
    firstName: openField(r.first_name_enc, config.dataKey, aad(r.id)),
    avatarColor: r.avatar_color,
    createdAt: r.created_at,
    parentCodeSetAt: r.parent_code_set_at ?? null
  })
  const childId = (req) => { if (!isUuid(req.params.id)) throw notFound(); return req.params.id }

  app.get('/', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM children WHERE family_id = $1 ORDER BY created_at, id`, [own.familyId])
    return rows.map(serialize)
  })

  app.post('/', { schema: { body: CREATE } }, async (req, reply) => {
    const name = firstName(req.body.firstName)
    const row = await withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      // Plafond sous verrou : deux ajouts simultanés ne le dépassent pas.
      await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`children:${own.familyId}`])
      const { rows: used } = await conn.query('SELECT avatar_color FROM children WHERE family_id = $1', [own.familyId])
      if (used.length >= MAX_CHILDREN) throw new HttpError(409, 'Nombre maximal d’enfants atteint.', 'too_many_children')
      const id = randomUUID()
      const color = req.body.avatarColor ?? leastUsedColor(used.map((r) => r.avatar_color))
      const { rows: [created] } = await conn.query(
        `INSERT INTO children(id, family_id, first_name_enc, avatar_color) VALUES ($1, $2, $3, $4)
         RETURNING ${COLUMNS}`, [id, own.familyId, seal(id, name), color])
      await audit(conn, req, 'child_added', id)
      return created
    })
    return reply.code(201).send(serialize(row))
  })

  // Écriture, rôle verrouillé et audit dans une même transaction : tout ou rien.
  app.patch('/:id', { schema: { body: UPDATE } }, async (req) => {
    const id = childId(req)
    const name = req.body.firstName === undefined ? undefined : firstName(req.body.firstName)
    const row = await withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const sets = [], values = [id, own.familyId]
      if (name !== undefined) { values.push(seal(id, name)); sets.push(`first_name_enc = $${values.length}`) }
      if (req.body.avatarColor !== undefined) { values.push(req.body.avatarColor); sets.push(`avatar_color = $${values.length}`) }
      const { rows: [updated] } = await conn.query(
        `UPDATE children SET ${sets.join(', ')} WHERE id = $1 AND family_id = $2 RETURNING ${COLUMNS}`, values)
      if (!updated) throw notFound()
      await audit(conn, req, 'child_updated', id)
      return updated
    })
    return serialize(row)
  })

  // Code parent (NAR-139) : seul son hachage est gardé, envoyé au seul téléphone de
  // l'enfant (GET /api/device/config). Le rôle est contrôlé avant le hachage (600 000
  // itérations), et chaque compte est limité : ni calcul gratuit ni arrosage.
  const parentCodeLimit = createLimiter({ max: 10, windowMs: 15 * 60_000 })
  app.put('/:id/parent-code', { schema: { body: PARENT_CODE } }, async (req) => {
    const id = childId(req)
    const own = await requireOwnFamily(db, req, MANAGERS)
    // Enfant d'une autre famille ou inconnu : 404 avant tout calcul et sans entamer le quota
    // (un enfant retiré pendant le calcul est refusé par l'UPDATE, après coup).
    const { rows: [found] } = await db.query('SELECT 1 FROM children WHERE id = $1 AND family_id = $2', [id, own.familyId])
    if (!found) throw notFound()
    const problem = parentCodeProblem(req.body.code)
    if (problem) throw new HttpError(400, problem === 'weak_parent_code' ? 'Code parent trop facile à deviner.' : 'Le code parent doit compter 6 chiffres.', problem)
    const release = reserveHashSlot()
    let hash
    try {
      if (!parentCodeLimit(req.user.id)) throw new HttpError(429, 'Trop de changements du code parent. Réessayez plus tard.')
      hash = await hashParentCode(req.body.code)
    } finally { release() }
    const row = await withTransaction(db, async (conn) => {
      // Rôle relu sous verrou : un gestionnaire rétrogradé pendant le calcul n'écrit rien.
      const locked = await lockOwnFamily(conn, req, MANAGERS)
      const { rows: [updated] } = await conn.query(
        `UPDATE children SET parent_code_hash = $3, parent_code_set_at = now()
          WHERE id = $1 AND family_id = $2 RETURNING parent_code_set_at`, [id, locked.familyId, hash])
      if (!updated) throw notFound()
      await audit(conn, req, 'parent_code_set', id)
      return updated
    })
    return { parentCodeSetAt: row.parent_code_set_at }
  })

  app.delete('/:id', async (req) => {
    const id = childId(req)
    await withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const { rows } = await conn.query('DELETE FROM children WHERE id = $1 AND family_id = $2 RETURNING id', [id, own.familyId])
      if (!rows[0]) throw notFound()
      await audit(conn, req, 'child_removed', id)
    })
    return { ok: true }
  })
}
