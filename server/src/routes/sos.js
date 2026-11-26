// SOS en ligne (NAR-248, tranche 1 de NAR-149 ; CdC §4.3, §5.4). Le chemin hors ligne (SMS,
// cascade d'appels, sirène : NAR-151) reste sur le téléphone ; celui-ci le double dès qu'il a
// du réseau, sans jamais l'attendre.
//
// Téléphone (session d'appareil, préfixe /api/device) :
//   POST /sos                   { clientId } : ouvre une alerte pour SON enfant (lu sur la
//                               session), 15 min. Idempotent : le même clientId renvoie la même
//                               alerte (201 la première fois, 200 ensuite), une seule
//                               notification `sos` par membre.
//   POST /sos/:id/cancel        annulation par l'enfant, dans les 5 s qui suivent l'ouverture
//                               (heure du serveur) ; après, 409 `sos_too_late` : une alerte
//                               ouverte n'est plus retirée depuis le téléphone (un enfant forcé
//                               d'annuler ne la ferme pas). Notification `sos_cancelled`.
//   POST /sos/:id/positions     { lat, lng, accuracyM, ageS } : relevé pendant l'alerte ouverte
//                               (ni annulée, ni prise en charge, moins de 15 min), sinon 409
//                               `sos_closed`. Chiffré comme une position à la demande.
// Membres (session de compte, préfixe /api ; tous les rôles, `member` compris) :
//   GET  /children/:id/sos      dernière alerte de l'enfant (24 h au plus), ou null.
//   GET  /sos/:id               alerte, dernière position, ce que chaque membre a fait.
//   POST /sos/:id/seen|coming   noté une fois par membre (heure de la première fois).
//   POST /sos/:id/handle        prise en charge : la première gagne (409 `sos_already_handled`
//                               ; l’auteur se lit par GET) ; refusée sur une alerte annulée.
// Alerte d'une autre famille ou inconnue : 404. Aucune route de l'équipe (admin) n'y mène.
// Ni position ni nom dans un journal, l'audit ou une notification (prénom de l'enfant seul).
import { HttpError, audit, isUuid } from '../lib.js'
import { withTransaction } from '../db.js'
import { ROLES, requireOwnFamily } from '../families.js'
import { createLimiter } from '../security.js'
import { sealField } from '../crypto-fields.js'
import { notifyFamily } from '../push.js'
import { openPosition, positionAad, coord, MAX_AGE_S } from './location.js'

export const SOS_MINUTES = 15
export const CANCEL_WINDOW_S = 5
// Alertes non annulées par téléphone et par 10 min (compté en base : des appuis annulés ne
// privent jamais d'un vrai SOS) ; le limiteur en mémoire ne fait que borner un envoi en boucle.
export const SOS_OPEN_MAX = 5
export const SOS_OPEN_WINDOW_MS = 10 * 60_000
const SOS_FLOOD_MAX = 30
// Une position toutes les 30 s, plus quelques renvois (réseau qui revient).
export const SOS_POSITIONS_MAX = 6
export const SOS_POSITIONS_WINDOW_MS = 60_000
// Une alerte plus vieille n'est plus montrée comme « la dernière » de l'enfant.
export const RECENT_HOURS = 24

const sosNotFound = () => new HttpError(404, 'Alerte introuvable.', 'sos_not_found')
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const noBody = (req) => {
  if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw new HttpError(400, 'Requête invalide.')
}

const OPEN = {
  type: 'object',
  additionalProperties: false,
  required: ['clientId'],
  properties: { clientId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' } }
}
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

// État lisible, calculé par la base (son horloge) : active, cancelled, handled, ended.
const STATUS_SQL = `CASE WHEN a.cancelled_at IS NOT NULL THEN 'cancelled'
                         WHEN a.handled_at IS NOT NULL THEN 'handled'
                         WHEN a.ends_at <= now() THEN 'ended' ELSE 'active' END AS status`
const shape = (a) => ({ id: a.id, childId: a.child_id, startedAt: a.started_at, endsAt: a.ends_at, cancelledAt: a.cancelled_at ?? null, handledAt: a.handled_at ?? null, status: a.status })

export async function deviceSosRoutes(app) {
  const { db, config } = app
  const openLimit = createLimiter({ max: SOS_FLOOD_MAX, windowMs: SOS_OPEN_WINDOW_MS })
  const positionsLimit = createLimiter({ max: SOS_POSITIONS_MAX, windowMs: SOS_POSITIONS_WINDOW_MS })
  const mine = (req) => {
    if (!isUuid(req.params.id)) throw sosNotFound()
    return req.params.id
  }

  app.post('/sos', { config: { device: true }, schema: { body: OPEN } }, async (req, reply) => {
    const clientId = req.body.clientId.toLowerCase()
    return withTransaction(db, async (conn) => {
      // Renvoi du même SOS (réseau revenu, réponse perdue) : la même alerte, sans compter au plafond.
      const { rows: [known] } = await conn.query(
        `SELECT a.*, ${STATUS_SQL} FROM sos_alerts a WHERE a.device_id = $1 AND a.client_id = $2`, [req.device.id, clientId])
      if (known) return shape(known)
      const { rows: [{ n }] } = await conn.query(
        `SELECT count(*)::int AS n FROM sos_alerts WHERE device_id = $1 AND cancelled_at IS NULL
            AND started_at > now() - $2 * interval '1 millisecond'`, [req.device.id, SOS_OPEN_WINDOW_MS])
      if (n >= SOS_OPEN_MAX || !openLimit(`device:${req.device.id}`)) throw new HttpError(429, 'Trop d’alertes. Réessayez dans quelques minutes.', 'sos_rate_limited')
      const { rows: [created] } = await conn.query(
        `INSERT INTO sos_alerts AS a (family_id, child_id, device_id, client_id, ends_at)
         SELECT d.family_id, d.child_id, d.id, $2, now() + make_interval(mins => $3)
           FROM child_devices d WHERE d.id = $1 AND d.revoked_at IS NULL
         ON CONFLICT (device_id, client_id) DO NOTHING
         RETURNING a.*, 'active' AS status`, [req.device.id, clientId, SOS_MINUTES])
      if (!created) {
        // Deux envois simultanés : l'autre a écrit ; téléphone révoqué entre-temps : session finie.
        const { rows: [raced] } = await conn.query(
          `SELECT a.*, ${STATUS_SQL} FROM sos_alerts a WHERE a.device_id = $1 AND a.client_id = $2`, [req.device.id, clientId])
        if (!raced) throw new HttpError(401, 'Session de l’appareil expirée.')
        return shape(raced)
      }
      // Chaque membre, `member` compris, dans la même transaction que l'alerte.
      await notifyFamily(conn, created.family_id, 'sos', created.id)
      await audit(conn, req, 'sos_started', created.id)
      reply.code(201)
      return shape(created)
    })
  })

  app.post('/sos/:id/cancel', { config: { device: true } }, async (req) => {
    noBody(req)
    const id = mine(req)
    return withTransaction(db, async (conn) => {
      const { rows: [a] } = await conn.query(
        `SELECT a.*, ${STATUS_SQL}, a.started_at > now() - make_interval(secs => $3) AS in_window
           FROM sos_alerts a WHERE a.id = $1 AND a.device_id = $2 FOR UPDATE`, [id, req.device.id, CANCEL_WINDOW_S])
      if (!a) throw sosNotFound()
      if (a.status === 'cancelled') return shape(a)
      if (a.status !== 'active' || !a.in_window) throw new HttpError(409, 'L’alerte ne peut plus être annulée depuis le téléphone.', 'sos_too_late')
      const { rows: [done] } = await conn.query(
        `UPDATE sos_alerts a SET cancelled_at = now() WHERE a.id = $1 RETURNING a.*, 'cancelled' AS status`, [id])
      await notifyFamily(conn, done.family_id, 'sos_cancelled', done.id)
      await audit(conn, req, 'sos_cancelled', done.id)
      return shape(done)
    })
  })

  app.post('/sos/:id/positions', { config: { device: true }, schema: { body: POSITION } }, async (req) => {
    const id = mine(req)
    const { lat, lng, accuracyM, ageS } = req.body
    if (!positionsLimit(`device:${req.device.id}`)) throw new HttpError(429, 'Trop d’envois. Réessayez dans une minute.', 'positions_rate_limited')
    return withTransaction(db, async (conn) => {
      // Alerte de CE téléphone, encore ouverte ; relevé pris pendant l'alerte (pas avant).
      const { rows: [a] } = await conn.query(
        `SELECT a.id, a.family_id, a.child_id, ${STATUS_SQL},
                now() - $3 * interval '1 second' < a.started_at - interval '30 seconds' AS too_old
           FROM sos_alerts a WHERE a.id = $1 AND a.device_id = $2`, [id, req.device.id, ageS])
      if (!a) throw sosNotFound()
      if (a.status !== 'active') throw new HttpError(409, 'Alerte terminée : la position n’est plus envoyée.', 'sos_closed')
      if (a.too_old) throw new HttpError(409, 'Position prise bien avant l’alerte.', 'stale_position')
      const { rows: [{ pid }] } = await conn.query('SELECT gen_random_uuid() AS pid')
      await conn.query(
        `INSERT INTO positions(id, family_id, child_id, device_id, lat_enc, lng_enc, accuracy_m, source, sos_id, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'sos', $8, now() - $9 * interval '1 second')`,
        [pid, a.family_id, a.child_id, req.device.id,
          sealField(coord(lat), config.dataKey, positionAad(pid, 'lat')),
          sealField(coord(lng), config.dataKey, positionAad(pid, 'lng')),
          Math.round(accuracyM), a.id, ageS])
      return { ok: true }
    })
  })
}

export async function sosRoutes(app) {
  const { db, config } = app

  // Alerte de la famille de la session ; une autre famille ou une alerte inconnue : 404.
  const alertOf = async (conn, req, { lock = false } = {}) => {
    if (!isUuid(req.params.id)) throw sosNotFound()
    const own = await requireOwnFamily(conn, req, ROLES)
    const { rows: [a] } = await conn.query(
      `SELECT a.*, ${STATUS_SQL} FROM sos_alerts a WHERE a.id = $1 AND a.family_id = $2${lock ? ' FOR UPDATE' : ''}`, [req.params.id, own.familyId])
    if (!a) throw sosNotFound()
    return a
  }

  async function details(conn, req, a) {
    const { rows: recent } = await conn.query(
      `SELECT id, lat_enc, lng_enc, accuracy_m, source, recorded_at FROM positions
        WHERE sos_id = $1 AND family_id = $2 ORDER BY recorded_at DESC, received_at DESC, id DESC LIMIT 5`, [a.id, a.family_id])
    let position = null
    for (const r of recent) if ((position = openPosition(config, r, req.log))) break
    if (position) delete position.source
    // Membres actuels seulement (un membre parti n'est plus montré) ; noms affichés, jamais d'adresse.
    const { rows: events } = await conn.query(
      `SELECT e.kind, e.at, e.user_id, u.name FROM sos_events e
         JOIN memberships m ON m.user_id = e.user_id AND m.family_id = $2
         JOIN users u ON u.id = e.user_id
        WHERE e.sos_id = $1 ORDER BY e.at, e.kind`, [a.id, a.family_id])
    // Auteur de la prise en charge : nommé tant qu'il est membre (parti : sans nom, comme les événements).
    const { rows: [handler] } = a.handled_by ? await conn.query(
      'SELECT u.name FROM users u JOIN memberships m ON m.user_id = u.id AND m.family_id = $2 WHERE u.id = $1', [a.handled_by, a.family_id]) : { rows: [] }
    return {
      ...shape(a),
      handledBy: a.handled_at ? { name: handler?.name ?? null, isMe: a.handled_by === req.user.id } : null,
      position,
      events: events.map((e) => ({ kind: e.kind, at: e.at, name: e.name, isMe: e.user_id === req.user.id }))
    }
  }

  app.get('/children/:id/sos', async (req) => {
    const own = await requireOwnFamily(db, req, ROLES)
    if (!isUuid(req.params.id)) throw childNotFound()
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!child) throw childNotFound()
    const { rows: [a] } = await db.query(
      `SELECT a.*, ${STATUS_SQL} FROM sos_alerts a
        WHERE a.child_id = $1 AND a.family_id = $2 AND a.started_at > now() - make_interval(hours => $3)
        ORDER BY a.started_at DESC, a.id DESC LIMIT 1`, [child.id, own.familyId, RECENT_HOURS])
    return { sos: a ? await details(db, req, a) : null }
  })

  app.get('/sos/:id', async (req) => details(db, req, await alertOf(db, req)))

  for (const kind of ['seen', 'coming']) {
    app.post(`/sos/:id/${kind}`, async (req) => {
      noBody(req)
      const a = await alertOf(db, req)
      await db.query(
        'INSERT INTO sos_events(sos_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT (sos_id, user_id, kind) DO NOTHING', [a.id, req.user.id, kind])
      return details(db, req, a)
    })
  }

  app.post('/sos/:id/handle', async (req) => {
    noBody(req)
    return withTransaction(db, async (conn) => {
      // Alerte verrouillée : deux prises en charge simultanées, une seule gagne.
      const a = await alertOf(conn, req, { lock: true })
      if (a.status === 'cancelled') throw new HttpError(409, 'Alerte annulée par l’enfant.', 'sos_cancelled')
      if (a.handled_at) {
        // Déjà pris par un autre : refus, l'écran relit l'alerte (qui la tient) par GET.
        if (a.handled_by === req.user.id) return details(conn, req, a)
        throw new HttpError(409, 'Déjà pris en charge.', 'sos_already_handled')
      }
      const { rows: [done] } = await conn.query(
        `UPDATE sos_alerts a SET handled_by = $2, handled_at = now() WHERE a.id = $1 RETURNING a.*, 'handled' AS status`, [a.id, req.user.id])
      await conn.query(
        'INSERT INTO sos_events(sos_id, user_id, kind) VALUES ($1, $2, \'handled\') ON CONFLICT (sos_id, user_id, kind) DO NOTHING', [a.id, req.user.id])
      await audit(conn, req, 'sos_handled', a.id)
      return details(conn, req, done)
    })
  })
}
