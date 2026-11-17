// Contacts autorisés d'un enfant (NAR-140). Lecture : membres de la famille ;
// écriture : owner et manager, rôle verrouillé dans la transaction. L'enfant est
// verrouillé (FOR UPDATE) : les écritures d'un même enfant se suivent, le plafond
// et l'ordre restent justes. Sa config_version avance par déclencheur
// (006_allowed_contacts.sql) ; le téléphone la compare pour se mettre à jour (NAR-160).
import { randomUUID } from 'node:crypto'
import { HttpError, audit, isUuid, text } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, lockFamilyMembers, requireOwnFamily } from '../families.js'
import { blindIndex, openField, sealField } from '../crypto-fields.js'
import { normalizePhone } from '../phone.js'
import { AVATAR_COLORS, leastUsedColor } from './children.js'

export const MAX_CONTACTS = 6

const FIELDS = {
  name: { type: 'string', maxLength: 200 },
  phone: { type: 'string', maxLength: 40 },
  avatarColor: { type: 'string', enum: AVATAR_COLORS },
  memberUserId: { type: ['string', 'null'], maxLength: 36 }
}
const CREATE = { type: 'object', additionalProperties: false, required: ['name', 'phone'], properties: FIELDS }
const UPDATE = { type: 'object', additionalProperties: false, minProperties: 1, properties: FIELDS }
const ORDER = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: { ids: { type: 'array', maxItems: MAX_CONTACTS, items: { type: 'string', maxLength: 36 } } }
}
const contactName = (v) => text(v, { min: 1, max: 40, field: 'Nom du contact' })
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const contactNotFound = () => new HttpError(404, 'Contact introuvable.', 'contact_not_found')
const duplicate = () => new HttpError(409, 'Ce numéro est déjà dans les contacts de cet enfant.', 'duplicate_phone')
const aad = (id, column) => `allowed_contacts:${column}:${id}`

export default async function contactsRoutes(app) {
  const { db, config } = app
  const key = config.dataKey
  const phoneIndex = (e164) => blindIndex(e164, key, 'phone')
  const serialize = (r) => ({
    id: r.id,
    childId: r.child_id,
    name: openField(r.name_enc, key, aad(r.id, 'name')),
    phone: openField(r.phone_enc, key, aad(r.id, 'phone')),
    position: r.position,
    avatarColor: r.avatar_color,
    memberUserId: r.member_user_id,
    memberRole: r.member_role ?? null
  })
  const SELECT = `SELECT c.id, c.child_id, c.name_enc, c.phone_enc, c.position, c.avatar_color, c.member_user_id, m.role AS member_role
                    FROM allowed_contacts c LEFT JOIN memberships m ON m.family_id = c.family_id AND m.user_id = c.member_user_id`

  // Enfant de la famille de la session, verrouillé pour la durée de la transaction.
  async function lockChild(conn, familyId, childId) {
    if (!isUuid(childId)) throw childNotFound()
    const { rows } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE', [childId, familyId])
    if (!rows[0]) throw childNotFound()
  }
  // Contact relu dans la transaction, après le verrou de l'enfant : un retrait
  // simultané se voit ici (404) au lieu d'écrire sur une ligne disparue.
  async function lockedContact(conn, familyId, contactId) {
    const { rows: [found] } = await conn.query('SELECT child_id FROM allowed_contacts WHERE id = $1 AND family_id = $2', [contactId, familyId])
    if (!found) throw contactNotFound()
    await lockChild(conn, familyId, found.child_id)
    const { rows: [still] } = await conn.query('SELECT child_id FROM allowed_contacts WHERE id = $1 AND family_id = $2 FOR UPDATE', [contactId, familyId])
    if (!still) throw contactNotFound()
    return still.child_id
  }
  const readOne = async (conn, id) => serialize((await conn.query(`${SELECT} WHERE c.id = $1`, [id])).rows[0])
  // Membre lié : de la même famille (la clé étrangère composite le garantit aussi).
  async function checkMember(conn, familyId, memberUserId) {
    if (memberUserId === null || memberUserId === undefined) return null
    if (!isUuid(memberUserId)) throw new HttpError(400, 'Membre inconnu.', 'member_not_found')
    const { rows } = await conn.query('SELECT 1 FROM memberships WHERE family_id = $1 AND user_id = $2', [familyId, memberUserId])
    if (!rows[0]) throw new HttpError(400, 'Membre inconnu.', 'member_not_found')
    return memberUserId
  }
  // Violation d'unicité traduite selon la contrainte : numéro en double, ou
  // positions concurrentes (ne devrait pas arriver sous le verrou de l'enfant).
  const unique = async (fn) => {
    try { return await fn() } catch (e) {
      if (e.code === '23505' && e.constraint === 'allowed_contacts_phone') throw duplicate()
      if (e.code === '23505' && e.constraint === 'allowed_contacts_member') throw new HttpError(409, 'Ce membre est déjà lié à un autre contact de cet enfant.', 'member_already_linked')
      if (e.code === '23505') throw new HttpError(409, 'La liste a changé entre-temps. Réessayez.', 'order_mismatch')
      throw e
    }
  }

  // Version et liste lues dans une même photo de la base (REPEATABLE READ).
  app.get('/children/:childId/contacts', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    if (!isUuid(req.params.childId)) throw childNotFound()
    return withTransaction(db, async (conn) => {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const { rows: [child] } = await conn.query('SELECT config_version FROM children WHERE id = $1 AND family_id = $2', [req.params.childId, own.familyId])
      if (!child) throw childNotFound()
      const { rows } = await conn.query(`${SELECT} WHERE c.child_id = $1 AND c.family_id = $2 ORDER BY c.position`, [req.params.childId, own.familyId])
      // Pays des numéros saisis sans indicatif : l'écran adapte l'exemple affiché.
      return { version: Number(child.config_version), max: MAX_CONTACTS, country: config.phoneCountry, contacts: rows.map(serialize) }
    })
  })

  app.post('/children/:childId/contacts', { schema: { body: CREATE } }, async (req, reply) => {
    const name = contactName(req.body.name)
    const phone = normalizePhone(req.body.phone, config.phoneCountry)
    const created = await unique(() => withTransaction(db, async (conn) => {
      const own = await lockFamilyMembers(conn, req, MANAGERS)
      await lockChild(conn, own.familyId, req.params.childId)
      const { rows: existing } = await conn.query('SELECT avatar_color FROM allowed_contacts WHERE child_id = $1', [req.params.childId])
      if (existing.length >= MAX_CONTACTS) throw new HttpError(409, 'Six contacts au plus par enfant.', 'too_many_contacts')
      const member = await checkMember(conn, own.familyId, req.body.memberUserId)
      const color = req.body.avatarColor ?? leastUsedColor(existing.map((r) => r.avatar_color))
      const newId = randomUUID()
      await conn.query(
        `INSERT INTO allowed_contacts(id, family_id, child_id, member_user_id, name_enc, phone_enc, phone_index, position, avatar_color)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newId, own.familyId, req.params.childId, member, sealField(name, key, aad(newId, 'name')), sealField(phone, key, aad(newId, 'phone')),
          phoneIndex(phone), existing.length + 1, color])
      await audit(conn, req, 'contact_added', newId, { childId: req.params.childId })
      return readOne(conn, newId)
    }))
    return reply.code(201).send(created)
  })

  app.patch('/contacts/:id', { schema: { body: UPDATE } }, async (req) => {
    if (!isUuid(req.params.id)) throw contactNotFound()
    const id = req.params.id
    const name = req.body.name === undefined ? undefined : contactName(req.body.name)
    const phone = req.body.phone === undefined ? undefined : normalizePhone(req.body.phone, config.phoneCountry)
    return unique(() => withTransaction(db, async (conn) => {
      const own = await lockFamilyMembers(conn, req, MANAGERS)
      const childId = await lockedContact(conn, own.familyId, id)
      const sets = [], values = [id, own.familyId]
      const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`) }
      if (name !== undefined) set('name_enc', sealField(name, key, aad(id, 'name')))
      if (phone !== undefined) { set('phone_enc', sealField(phone, key, aad(id, 'phone'))); set('phone_index', phoneIndex(phone)) }
      if (req.body.avatarColor !== undefined) set('avatar_color', req.body.avatarColor)
      if (req.body.memberUserId !== undefined) set('member_user_id', await checkMember(conn, own.familyId, req.body.memberUserId))
      await conn.query(`UPDATE allowed_contacts SET ${sets.join(', ')} WHERE id = $1 AND family_id = $2`, values)
      await audit(conn, req, 'contact_updated', id, { childId })
      return readOne(conn, id)
    }))
  })

  app.delete('/contacts/:id', async (req) => {
    if (!isUuid(req.params.id)) throw contactNotFound()
    await withTransaction(db, async (conn) => {
      const own = await lockFamilyMembers(conn, req, MANAGERS)
      const childId = await lockedContact(conn, own.familyId, req.params.id)
      await conn.query('DELETE FROM allowed_contacts WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
      // Positions recomptées sans trou : 1, 2, 3…
      await conn.query(
        `UPDATE allowed_contacts c SET position = n.rank
           FROM (SELECT id, row_number() OVER (ORDER BY position) AS rank FROM allowed_contacts WHERE child_id = $1) n
          WHERE c.id = n.id AND c.position <> n.rank`, [childId])
      await audit(conn, req, 'contact_removed', req.params.id, { childId })
    })
    return { ok: true }
  })

  // Nouvel ordre : la liste complète des contacts de l'enfant, chacun une fois.
  app.put('/children/:childId/contacts/order', { schema: { body: ORDER } }, async (req) => {
    const ids = req.body.ids
    await withTransaction(db, async (conn) => {
      const own = await lockFamilyMembers(conn, req, MANAGERS)
      await lockChild(conn, own.familyId, req.params.childId)
      const { rows } = await conn.query('SELECT id FROM allowed_contacts WHERE child_id = $1', [req.params.childId])
      const current = new Set(rows.map((r) => r.id))
      if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id) => current.has(id))) {
        throw new HttpError(409, 'La liste a changé entre-temps. Rechargez-la.', 'order_mismatch')
      }
      // Seules les positions qui changent sont écrites ; un ordre identique ne touche rien.
      const { rowCount } = await conn.query(
        `UPDATE allowed_contacts c SET position = o.rank
           FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, rank) WHERE c.id = o.id AND c.child_id = $2 AND c.position <> o.rank`, [ids, req.params.childId])
      if (rowCount) await audit(conn, req, 'contacts_reordered', req.params.childId)
    })
    return { ok: true }
  })
}
