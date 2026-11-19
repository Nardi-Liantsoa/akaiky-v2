// Messages rapides de l'enfant (NAR-150).
//
// Côté téléphone (session d'appareil, préfixe /api/device) :
//   POST /messages          envoi d'un des 4 messages, pour SON enfant (lu sur la session) ;
//                           idempotent (identifiant choisi par le téléphone).
//   GET  /messages          ses derniers messages (24 h) et qui les a vus.
// Côté parents (session de compte, préfixe /api) :
//   GET  /children/:id/messages   membres : derniers messages et « vu par » ;
//   POST /messages/:id/read       membres de la famille du message : marque comme vu.
//   GET  /children/:id/message-templates        membres : textes des 4 messages (null = défaut) ;
//   PUT  /children/:id/message-templates/:slot  owner, manager : texte (1 à 40) ou null (défaut). NAR-173
// Les noms des lecteurs : nom du contact lié au membre s'il existe (« Maman »), sinon le
// nom du compte. Jamais d'adresse ni de rôle.
import { HttpError, audit, isUuid, text } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, lockOwnFamily, requireOwnFamily } from '../families.js'
import { createLimiter } from '../security.js'
import { openField, sealField } from '../crypto-fields.js'
import { contactAad } from './contacts.js'

const SEND = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'slot', 'sentAt'],
  properties: {
    id: { type: 'string', maxLength: 36 },
    slot: { type: 'integer', minimum: 1, maximum: 4 },
    sentAt: { type: 'string', maxLength: 40 }
  }
}
// Données associées des textes chiffrés : liés à leur enfant et emplacement, ou au message.
export const templateAad = (childId, slot) => `quick_message_templates:text:${childId}:${slot}`
export const messageTextAad = (id) => `quick_messages:text:${id}`
// Texte d'un message tel qu'envoyé (NAR-173) ; null = texte par défaut traduit par l'app.
export const sentText = (config, r) => r.text_enc ? openField(r.text_enc, config.dataKey, messageTextAad(r.id)) : null
const notFound = () => new HttpError(404, 'Message introuvable.', 'message_not_found')
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')

// Lecteurs de chaque message (membres actuels de la famille), nom affiché au choix.
export async function readersOf(db, config, familyId, childId, ids) {
  if (!ids.length) return new Map()
  const { rows } = await db.query(
    `SELECT r.message_id, r.user_id, r.read_at, u.name, c.id AS contact_id, c.name_enc
       FROM quick_message_reads r
       JOIN memberships m ON m.user_id = r.user_id AND m.family_id = $1
       JOIN users u ON u.id = r.user_id
       LEFT JOIN allowed_contacts c ON c.member_user_id = r.user_id AND c.child_id = $2 AND c.family_id = $1
      WHERE r.message_id = ANY($3::uuid[])
      ORDER BY r.read_at`, [familyId, childId, ids])
  const out = new Map()
  for (const r of rows) {
    const name = r.name_enc ? openField(r.name_enc, config.dataKey, contactAad(r.contact_id, 'name')) : r.name
    if (!out.has(r.message_id)) out.set(r.message_id, [])
    out.get(r.message_id).push({ userId: r.user_id, name, readAt: r.read_at })
  }
  return out
}

export async function deviceMessagesRoutes(app) {
  const { db, config } = app
  const sendLimit = createLimiter({ max: 30, windowMs: 60_000 })

  app.post('/messages', { config: { device: true }, schema: { body: SEND } }, async (req) => {
    const { id, slot, sentAt } = req.body
    if (!isUuid(id)) throw new HttpError(400, 'Message invalide.', 'invalid_message')
    // Heure du téléphone : gardée si plausible, sinon heure de réception (horloge remise à
    // zéro d'un téléphone bas de gamme : le message n'est jamais perdu pour autant).
    const sent = Date.parse(sentAt)
    const now = Date.now()
    const when = !Number.isNaN(sent) && sent <= now + 5 * 60_000 && sent >= now - 30 * 86_400_000 ? new Date(sent) : new Date(now)
    return withTransaction(db, async (conn) => {
      const { rowCount: known } = await conn.query('SELECT 1 FROM quick_messages WHERE id = $1 AND child_id = $2', [id, req.device.childId])
      if (known) return { id }
      // Seuls les nouveaux messages comptent (un rejeu de la file hors ligne ne bloque rien).
      if (!sendLimit(`device:${req.device.id}`)) throw new HttpError(429, 'Trop de messages. Réessayez dans une minute.')
      // Texte modifié par un gestionnaire (NAR-173) : gardé avec le message, tel qu'il était
      // à la réception, pour que le journal montre le texte envoyé.
      const { rows: [tpl] } = await conn.query(
        'SELECT text_enc FROM quick_message_templates WHERE child_id = $1 AND family_id = $2 AND slot = $3',
        [req.device.childId, req.device.familyId, slot])
      const textEnc = tpl ? sealField(openField(tpl.text_enc, config.dataKey, templateAad(req.device.childId, slot)), config.dataKey, messageTextAad(id)) : null
      const { rowCount } = await conn.query(
        `INSERT INTO quick_messages(id, family_id, child_id, device_id, slot, sent_at, text_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
        [id, req.device.familyId, req.device.childId, req.device.id, slot, when, textEnc])
      if (!rowCount) {
        // Même message arrivé en même temps (renvoi après un délai dépassé) : accepté ;
        // identifiant pris par un autre enfant : refusé.
        const { rowCount: mine } = await conn.query('SELECT 1 FROM quick_messages WHERE id = $1 AND child_id = $2', [id, req.device.childId])
        if (!mine) throw new HttpError(409, 'Identifiant déjà utilisé.', 'message_conflict')
      }
      return { id }
    })
  })

  app.get('/messages', { config: { device: true } }, async (req) => {
    const { rows } = await db.query(
      `SELECT id, slot, sent_at, text_enc FROM quick_messages
        WHERE child_id = $1 AND family_id = $2 AND created_at > now() - interval '24 hours'
        ORDER BY created_at DESC, id DESC LIMIT 20`, [req.device.childId, req.device.familyId])
    const readers = await readersOf(db, config, req.device.familyId, req.device.childId, rows.map((r) => r.id))
    // Le téléphone ne reçoit que les prénoms affichés et l'heure, jamais les identifiants des comptes.
    return rows.map((r) => ({
      id: r.id, slot: r.slot, sentAt: r.sent_at, text: sentText(config, r),
      readBy: (readers.get(r.id) ?? []).map((x) => ({ name: x.name, readAt: x.readAt }))
    }))
  })
}

export async function messagesRoutes(app) {
  const { db, config } = app

  app.get('/children/:id/messages', async (req) => {
    if (!isUuid(req.params.id)) throw childNotFound()
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!child) throw childNotFound()
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50))
    // Ordre de réception (horloge du serveur) : l'heure d'un téléphone mal réglé ne le fausse pas.
    const { rows } = await db.query(
      `SELECT id, slot, sent_at, text_enc FROM quick_messages WHERE child_id = $1 AND family_id = $2
        ORDER BY created_at DESC, id DESC LIMIT $3`, [child.id, own.familyId, limit])
    const readers = await readersOf(db, config, own.familyId, child.id, rows.map((r) => r.id))
    return rows.map((r) => {
      const readBy = readers.get(r.id) ?? []
      return {
        id: r.id, slot: r.slot, sentAt: r.sent_at, text: sentText(config, r),
        readBy: readBy.map((x) => ({ name: x.name, readAt: x.readAt })),
        readByMe: readBy.some((x) => x.userId === req.user.id)
      }
    })
  })

  // Vu : seulement un membre de la famille du message (sinon 404, comme inexistant).
  app.post('/messages/:id/read', async (req) => {
    if (!isUuid(req.params.id)) throw notFound()
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [message] } = await db.query('SELECT id FROM quick_messages WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!message) throw notFound()
    try {
      await db.query('INSERT INTO quick_message_reads(message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [message.id, req.user.id])
    } catch (e) {
      // Message purgé entre la lecture et l'insertion : même réponse qu'un message inconnu.
      if (e.code === '23503') throw notFound()
      throw e
    }
    return { ok: true }
  })

  // Textes des messages rapides (NAR-173).
  const childOf = async (conn, familyId, childId) => {
    if (!isUuid(childId)) throw childNotFound()
    const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [childId, familyId])
    if (!child) throw childNotFound()
    return child.id
  }

  app.get('/children/:id/message-templates', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    const childId = await childOf(db, own.familyId, req.params.id)
    const { rows } = await db.query('SELECT slot, text_enc FROM quick_message_templates WHERE child_id = $1 AND family_id = $2', [childId, own.familyId])
    const bySlot = new Map(rows.map((r) => [r.slot, openField(r.text_enc, config.dataKey, templateAad(childId, r.slot))]))
    return [1, 2, 3, 4].map((slot) => ({ slot, text: bySlot.get(slot) ?? null }))
  })

  // Corps validé à la main, après les droits : un contact reçoit 403 quoi qu'il envoie.
  app.put('/children/:id/message-templates/:slot', async (req) => {
    return withTransaction(db, async (conn) => {
      // Droits d'abord : un contact reçoit 403, quel que soit ce qu'il envoie.
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const childId = await childOf(conn, own.familyId, req.params.id)
      const slot = Number(req.params.slot)
      if (![1, 2, 3, 4].includes(slot)) throw new HttpError(404, 'Message introuvable.', 'message_not_found')
      // Texte libre du parent : 1 à 40 caractères ; null remet le texte par défaut.
      const body = req.body
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join() !== 'text') throw new HttpError(400, 'Requête invalide.')
      const value = body.text === null ? null : text(body.text, { min: 1, max: 40, field: 'Texte' })
      // Enfant verrouillé : deux enregistrements simultanés du même texte n'écrivent qu'une fois.
      await conn.query('SELECT 1 FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE', [childId, own.familyId])
      const { rows: [current] } = await conn.query(
        'SELECT text_enc FROM quick_message_templates WHERE child_id = $1 AND family_id = $2 AND slot = $3', [childId, own.familyId, slot])
      const before = current ? openField(current.text_enc, config.dataKey, templateAad(childId, slot)) : null
      // Rien ne change : ni écriture, ni audit, ni nouvelle version de la configuration du téléphone.
      if (before === value) return { slot, text: value }
      if (value === null) {
        await conn.query('DELETE FROM quick_message_templates WHERE child_id = $1 AND family_id = $2 AND slot = $3', [childId, own.familyId, slot])
      } else {
        await conn.query(
          `INSERT INTO quick_message_templates(family_id, child_id, slot, text_enc) VALUES ($1, $2, $3, $4)
           ON CONFLICT (child_id, slot) DO UPDATE SET text_enc = EXCLUDED.text_enc, updated_at = now()`,
          [own.familyId, childId, slot, sealField(value, config.dataKey, templateAad(childId, slot))])
      }
      await audit(conn, req, 'message_template_set', childId, { slot })
      return { slot, text: value }
    })
  })
}
