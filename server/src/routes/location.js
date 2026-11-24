// Position de l'enfant à la demande (NAR-203, tranche serveur de NAR-146 ; CdC §5.2, §7.3).
// Jamais de suivi : le téléphone ne prend une position que si un membre la demande, et le
// serveur refuse toute position envoyée hors d'une demande ouverte.
//
// Parents (session de compte, préfixe /api) :
//   POST /children/:id/locate    tous les membres : ouvre (ou prolonge) sa demande pour
//                                WATCH_MS et met en file un réveil silencieux `locate` vers
//                                les téléphones actifs de l'enfant. Audité, sans position.
//                                LOCATE_MAX par LOCATE_WINDOW_MS, par membre et par enfant.
//   GET  /children/:id/position  tous les membres : dernière position reçue (lat, lng,
//                                précision, heure du relevé), sa demande en cours.
// Téléphone (session d'appareil, préfixe /api/device) :
//   GET  /locate                 relevé dû (`pending`) et qui regarde (`watchers`, noms
//                                affichés seulement) : indicateur « ton parent regarde ».
//   POST /positions              { lat, lng, accuracyM, ageS } : un relevé pour SON enfant
//                                (lu sur la session), accepté pendant une demande ouverte
//                                seulement (sinon 409 `no_request`). `ageS` : âge du relevé
//                                mesuré par l'horloge monotone du téléphone, jamais son heure
//                                (souvent fausse sur un téléphone bas de gamme).
// Les coordonnées ne sont écrites ni dans un journal, ni dans l'audit, ni dans une
// notification ; l'équipe (routes admin) n'a aucune route vers elles.
import { HttpError, audit, isUuid } from '../lib.js'
import { withTransaction } from '../db.js'
import { ROLES, requireOwnFamily } from '../families.js'
import { createLimiter } from '../security.js'
import { openField, sealField } from '../crypto-fields.js'
import { contactAad } from './contacts.js'
import { notifyDevice } from '../push.js'

// Durée d'une consultation : la page du parent la prolonge en redemandant.
export const WATCH_MS = 2 * 60_000
export const LOCATE_MAX = 10
export const LOCATE_WINDOW_MS = 10 * 60_000
export const POSITIONS_MAX = 6
export const POSITIONS_WINDOW_MS = 60_000
// Relevé plus vieux : refusé (une position « dernière connue » ancienne tromperait le parent).
export const MAX_AGE_S = 600

export const positionAad = (id, field) => `positions:${field}:${id}`
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')

// Coordonnée gardée au millionième de degré (~0,1 m) : la précision réelle est dans accuracy_m.
const coord = (n) => String(Math.round(n * 1e6) / 1e6)

const POSITION = {
  type: 'object',
  additionalProperties: false,
  required: ['lat', 'lng', 'accuracyM', 'ageS'],
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    accuracyM: { type: 'number', minimum: 0, maximum: 100000 },
    ageS: { type: 'integer', minimum: 0, maximum: MAX_AGE_S }
  }
}

// Position lisible par la famille ; un chiffré illisible ne donne aucune position.
export function openPosition(config, r, log) {
  try {
    return {
      lat: Number(openField(r.lat_enc, config.dataKey, positionAad(r.id, 'lat'))),
      lng: Number(openField(r.lng_enc, config.dataKey, positionAad(r.id, 'lng'))),
      accuracyM: r.accuracy_m, recordedAt: r.recorded_at, source: r.source
    }
  } catch {
    log?.error({ table: 'positions', id: r.id }, 'position chiffrée illisible')
    return null
  }
}

export async function locationRoutes(app) {
  const { db, config } = app
  const limit = createLimiter({ max: LOCATE_MAX, windowMs: LOCATE_WINDOW_MS })

  const childOf = async (conn, familyId, childId) => {
    if (!isUuid(childId)) throw childNotFound()
    const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [childId, familyId])
    if (!child) throw childNotFound()
    return child.id
  }

  app.post('/children/:id/locate', async (req) => {
    // Aucun corps attendu : un champ envoyé est une erreur, pas un réglage ignoré.
    if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw new HttpError(400, 'Requête invalide.')
    const own = await requireOwnFamily(db, req, ROLES)
    const childId = await childOf(db, own.familyId, req.params.id)
    if (!limit(`${req.user.id}:${childId}`)) throw new HttpError(429, 'Trop de demandes. Réessayez dans quelques minutes.', 'locate_rate_limited')
    return withTransaction(db, async (conn) => {
      const { rows: [r] } = await conn.query(
        `INSERT INTO location_requests(family_id, child_id, user_id, watch_until)
         VALUES ($1, $2, $3, now() + $4 * interval '1 millisecond')
         ON CONFLICT (child_id, user_id) DO UPDATE SET created_at = now(), watch_until = EXCLUDED.watch_until
         RETURNING created_at, watch_until`, [own.familyId, childId, req.user.id, WATCH_MS])
      // Réveil de chaque téléphone actif de l'enfant (aucune position, aucun nom dans le push).
      const { rows: devices } = await conn.query(
        'SELECT id FROM child_devices WHERE child_id = $1 AND family_id = $2 AND revoked_at IS NULL', [childId, own.familyId])
      let queued = 0
      for (const d of devices) queued += (await notifyDevice(conn, d.id, 'locate', childId)).queued
      await audit(conn, req, 'position_requested', childId)
      return { requestedAt: r.created_at, watchingUntil: r.watch_until, devices: devices.length, woken: queued }
    })
  })

  app.get('/children/:id/position', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    const childId = await childOf(db, own.familyId, req.params.id)
    const { rows: [last] } = await db.query(
      `SELECT id, lat_enc, lng_enc, accuracy_m, source, recorded_at FROM positions
        WHERE child_id = $1 AND family_id = $2 ORDER BY received_at DESC, id DESC LIMIT 1`, [childId, own.familyId])
    const { rows: [mine] } = await db.query(
      'SELECT created_at, watch_until FROM location_requests WHERE child_id = $1 AND family_id = $2 AND user_id = $3',
      [childId, own.familyId, req.user.id])
    const open = mine && mine.watch_until > new Date()
    return {
      position: last ? openPosition(config, last, req.log) : null,
      requestedAt: open ? mine.created_at : null,
      watchingUntil: open ? mine.watch_until : null
    }
  })
}

export async function deviceLocationRoutes(app) {
  const { db, config } = app
  const limit = createLimiter({ max: POSITIONS_MAX, windowMs: POSITIONS_WINDOW_MS })

  // Demandes ouvertes des membres actuels de la famille (un membre parti ne regarde plus).
  const openRequests = (conn, device) => conn.query(
    `SELECT r.user_id, r.created_at, r.watch_until, u.name, c.id AS contact_id, c.name_enc
       FROM location_requests r
       JOIN memberships m ON m.user_id = r.user_id AND m.family_id = r.family_id
       JOIN users u ON u.id = r.user_id
       LEFT JOIN allowed_contacts c ON c.member_user_id = r.user_id AND c.child_id = r.child_id AND c.family_id = r.family_id
      WHERE r.child_id = $1 AND r.family_id = $2 AND r.watch_until > now()
      ORDER BY r.created_at`, [device.childId, device.familyId])

  app.get('/locate', { config: { device: true } }, async (req) => {
    const { rows } = await openRequests(db, req.device)
    const { rows: [last] } = await db.query(
      'SELECT max(received_at) AS at FROM positions WHERE device_id = $1', [req.device.id])
    const latest = rows.reduce((t, r) => (r.created_at > t ? r.created_at : t), new Date(0))
    // Un contact lié au membre donne son nom (« Maman »), sinon le nom du compte ; jamais
    // d'identifiant de compte ni d'adresse vers le téléphone.
    const watchers = rows.map((r) => {
      let name = r.name
      if (r.name_enc) { try { name = openField(r.name_enc, config.dataKey, contactAad(r.contact_id, 'name')) } catch { /* nom du compte */ } }
      return { name }
    })
    return {
      pending: rows.length > 0 && (!last.at || latest > last.at),
      watchers,
      watchingUntil: rows.length ? rows.reduce((t, r) => (r.watch_until > t ? r.watch_until : t), new Date(0)) : null
    }
  })

  app.post('/positions', { config: { device: true }, schema: { body: POSITION } }, async (req) => {
    const { lat, lng, accuracyM, ageS } = req.body
    if (!limit(`device:${req.device.id}`)) throw new HttpError(429, 'Trop d’envois. Réessayez dans une minute.')
    return withTransaction(db, async (conn) => {
      // Aucune demande ouverte : pas de suivi, le relevé n'est pas gardé.
      const { rows: [open] } = await conn.query(
        `SELECT 1 FROM location_requests r JOIN memberships m ON m.user_id = r.user_id AND m.family_id = r.family_id
          WHERE r.child_id = $1 AND r.family_id = $2 AND r.watch_until > now() LIMIT 1`, [req.device.childId, req.device.familyId])
      if (!open) throw new HttpError(409, 'Aucune demande de position en cours.', 'no_request')
      const { rows: [{ id }] } = await conn.query('SELECT gen_random_uuid() AS id')
      await conn.query(
        `INSERT INTO positions(id, family_id, child_id, device_id, lat_enc, lng_enc, accuracy_m, source, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'on_demand', now() - $8 * interval '1 second')`,
        [id, req.device.familyId, req.device.childId, req.device.id,
          sealField(coord(lat), config.dataKey, positionAad(id, 'lat')),
          sealField(coord(lng), config.dataKey, positionAad(id, 'lng')),
          Math.round(accuracyM), ageS])
      return { ok: true }
    })
  })
}
