// Plages horaires « école » d'un enfant (NAR-148).
//   GET    /children/:id/schedules        membres
//   POST   /children/:id/schedules        owner, manager (10 par enfant)
//   PUT    /children/:id/schedules/:sid   owner, manager (remplacement complet)
//   DELETE /children/:id/schedules/:sid   owner, manager
// Corps validés à la main APRÈS les droits : un contact reçoit 403 quoi qu'il envoie.
// Le téléphone reçoit les plages par sa configuration (devices.js) et les applique seul,
// hors ligne, dans le fuseau de la famille.
import { randomUUID } from 'node:crypto'
import { HttpError, audit, isUuid, text } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, lockOwnFamily, requireOwnFamily } from '../families.js'
import { openField, sealField } from '../crypto-fields.js'

export const MAX_SCHEDULES = 10
export const scheduleAad = (id) => `schedules:label:${id}`
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const scheduleNotFound = () => new HttpError(404, 'Plage introuvable.', 'schedule_not_found')
const invalid = () => new HttpError(400, 'Plage invalide.', 'invalid_schedule')
const FIELDS = ['label', 'days', 'startMin', 'endMin', 'enabled']
const minute = (v) => Number.isInteger(v) && v >= 0 && v <= 1439

// Plage lue d'une ligne, champ par champ (le nom est déchiffré).
export const scheduleOf = (config, r) => ({
  id: r.id,
  label: openField(r.label_enc, config.dataKey, scheduleAad(r.id)),
  days: r.days_mask,
  startMin: r.start_min,
  endMin: r.end_min,
  enabled: r.enabled
})

// Création : enabled facultatif (vrai). Remplacement (PUT) : tous les champs, enabled
// compris : une plage désactivée n'est jamais réactivée par un oubli.
function parse(body, { replace = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid()
  const keys = Object.keys(body)
  const required = replace ? FIELDS : FIELDS.slice(0, 4)
  if (keys.some((k) => !FIELDS.includes(k)) || required.some((k) => !(k in body))) throw invalid()
  const { days, startMin, endMin } = body
  const enabled = body.enabled ?? true
  if (!Number.isInteger(days) || days < 1 || days > 127 || !minute(startMin) || !minute(endMin) || startMin === endMin || typeof enabled !== 'boolean') throw invalid()
  return { label: text(body.label, { min: 1, max: 30, field: 'Nom' }), days, startMin, endMin, enabled }
}

async function lockedChild(conn, familyId, childId) {
  if (!isUuid(childId)) throw childNotFound()
  // Verrou : plafond juste sous deux créations simultanées.
  const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE', [childId, familyId])
  if (!child) throw childNotFound()
  return child.id
}

export async function schedulesRoutes(app) {
  const { db, config } = app

  app.get('/children/:id/schedules', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    if (!isUuid(req.params.id)) throw childNotFound()
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!child) throw childNotFound()
    const { rows } = await db.query(
      'SELECT * FROM schedules WHERE child_id = $1 AND family_id = $2 ORDER BY start_min, created_at, id', [child.id, own.familyId])
    return rows.map((r) => scheduleOf(config, r))
  })

  app.post('/children/:id/schedules', async (req, reply) => {
    return withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const childId = await lockedChild(conn, own.familyId, req.params.id)
      const s = parse(req.body)
      const { rows: [{ n }] } = await conn.query('SELECT count(*)::int AS n FROM schedules WHERE child_id = $1', [childId])
      if (n >= MAX_SCHEDULES) throw new HttpError(409, `${MAX_SCHEDULES} plages au plus.`, 'too_many_schedules')
      const id = randomUUID()
      const { rows: [row] } = await conn.query(
        `INSERT INTO schedules(id, family_id, child_id, label_enc, days_mask, start_min, end_min, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [id, own.familyId, childId, sealField(s.label, config.dataKey, scheduleAad(id)), s.days, s.startMin, s.endMin, s.enabled])
      await audit(conn, req, 'schedule_create', childId, { schedule: id })
      reply.code(201)
      return scheduleOf(config, row)
    })
  })

  app.put('/children/:id/schedules/:sid', async (req) => {
    return withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const childId = await lockedChild(conn, own.familyId, req.params.id)
      if (!isUuid(req.params.sid)) throw scheduleNotFound()
      const s = parse(req.body, { replace: true })
      const { rows: [row] } = await conn.query(
        `UPDATE schedules SET label_enc = $4, days_mask = $5, start_min = $6, end_min = $7, enabled = $8
          WHERE id = $1 AND child_id = $2 AND family_id = $3 RETURNING *`,
        [req.params.sid, childId, own.familyId, sealField(s.label, config.dataKey, scheduleAad(req.params.sid)), s.days, s.startMin, s.endMin, s.enabled])
      if (!row) throw scheduleNotFound()
      await audit(conn, req, 'schedule_update', childId, { schedule: row.id })
      return scheduleOf(config, row)
    })
  })

  app.delete('/children/:id/schedules/:sid', async (req) => {
    return withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const childId = await lockedChild(conn, own.familyId, req.params.id)
      if (!isUuid(req.params.sid)) throw scheduleNotFound()
      const { rowCount } = await conn.query('DELETE FROM schedules WHERE id = $1 AND child_id = $2 AND family_id = $3', [req.params.sid, childId, own.familyId])
      if (!rowCount) throw scheduleNotFound()
      await audit(conn, req, 'schedule_delete', childId, { schedule: req.params.sid })
      return { ok: true }
    })
  })
}
