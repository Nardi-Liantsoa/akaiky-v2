// Journal de l'enfant (NAR-152) : appels sortants, reçus et bloqués, déverrouillages
// (device_events) et messages rapides (quick_messages), du plus récent au plus ancien.
//   GET /children/:id/journal?kind=all|calls|blocked|messages|unlocks&before=<curseur>&limit=&counts=1
// Tous les membres de la famille ; jamais l'admin de la plateforme (pas membre). Pages
// par curseur (date, identifiant) : ni doublon ni trou si de nouveaux événements arrivent
// pendant la lecture. Numéros et noms déchiffrés ici seulement, champ par champ.
// SOS et alertes du téléphone s'y ajouteront avec leurs tickets (NAR-149, NAR-147).
import { HttpError, isUuid } from '../lib.js'
import { ROLES, requireOwnFamily } from '../families.js'
import { openField } from '../crypto-fields.js'
import { eventAad } from './devices.js'
import { readersOf, sentText } from './messages.js'

const KINDS = {
  all: { events: ['call_out', 'call_in', 'call_blocked', 'unlock'], messages: true },
  calls: { events: ['call_out', 'call_in'], messages: false },
  blocked: { events: ['call_blocked'], messages: false },
  messages: { events: [], messages: true },
  unlocks: { events: ['unlock'], messages: false }
}
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')

export async function journalRoutes(app) {
  const { db, config } = app

  app.get('/children/:id/journal', async (req) => {
    if (!isUuid(req.params.id)) throw childNotFound()
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!child) throw childNotFound()

    const kind = KINDS[typeof req.query.kind === 'string' && KINDS[req.query.kind] ? req.query.kind : 'all']
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? '30'), 10) || 30))
    // Curseur « date_identifiant » du dernier élément de la page précédente.
    let cursor = [null, null]
    if (req.query.before !== undefined) {
      // Curseur abîmé : refusé (renvoyer la première page la doublerait à l'écran).
      const [beforeAt, beforeId] = typeof req.query.before === 'string' ? req.query.before.split('_') : []
      if (!beforeAt || Number.isNaN(Date.parse(beforeAt)) || !isUuid(beforeId)) throw new HttpError(400, 'Curseur invalide.', 'invalid_cursor')
      cursor = [new Date(beforeAt), beforeId]
    }

    // Messages : à l'heure de réception (horloge du serveur, NAR-150) ; appels : à l'heure
    // où ils ont eu lieu. Une seule liste, triée sur (date, identifiant).
    const { rows } = await db.query(
      `SELECT * FROM (
         SELECT 'event' AS source, id, kind, date_trunc('milliseconds', started_at) AS at, contact_id, name_enc, phone_enc, duration_s, unlock_source, NULL::smallint AS slot, NULL::bytea AS text_enc
           FROM device_events WHERE child_id = $1 AND family_id = $2 AND kind = ANY($3::text[])
         UNION ALL
         -- Millisecondes : le curseur (ISO) n'en garde pas plus ; sinon un message de la même
         -- milliseconde que le dernier de la page tomberait entre deux pages.
         SELECT 'message', id, 'message', date_trunc('milliseconds', created_at), NULL, NULL, NULL, NULL, NULL, slot, text_enc
           FROM quick_messages WHERE child_id = $1 AND family_id = $2 AND $4
       ) j
       WHERE ($5::timestamptz IS NULL OR (at, id) < ($5, $6::uuid))
       ORDER BY at DESC, id DESC LIMIT $7`,
      [child.id, own.familyId, kind.events, kind.messages, cursor[0], cursor[1], limit + 1])
    const page = rows.slice(0, limit)
    const readers = await readersOf(db, config, own.familyId, child.id, page.filter((r) => r.source === 'message').map((r) => r.id))

    const items = page.map((r) => {
      if (r.source === 'message') {
        const readBy = readers.get(r.id) ?? []
        // text : texte modifié tel qu'envoyé (NAR-173) ; null = texte par défaut traduit.
        return { id: r.id, kind: 'message', at: r.at, slot: r.slot, text: sentText(config, r), readBy: readBy.map((x) => ({ name: x.name, readAt: x.readAt })), readByMe: readBy.some((x) => x.userId === req.user.id) }
      }
      return {
        id: r.id,
        kind: r.kind,
        at: r.at,
        contactId: r.contact_id,
        name: r.name_enc ? openField(r.name_enc, config.dataKey, eventAad(r.id, 'name')) : null,
        phone: r.phone_enc ? openField(r.phone_enc, config.dataKey, eventAad(r.id, 'phone')) : null,
        durationS: r.duration_s,
        ...(r.kind === 'unlock' ? { source: r.unlock_source } : {})
      }
    })
    const last = page.at(-1)
    const next = rows.length > limit && last ? `${last.at.toISOString()}_${last.id}` : null
    if (cursor[0] || req.query.counts !== '1') return { items, next }
    // Nombres du jour (tuiles de synthèse, NAR-175) : jour de Madagascar, borné des deux
    // côtés (un téléphone en avance ne compte jamais demain dans aujourd'hui). Seulement sur
    // demande et en première page : ils ne dépendent ni du filtre ni de la page.
    const { rows: [c] } = await db.query(
      `WITH day AS (
         SELECT date_trunc('day', now() AT TIME ZONE 'Indian/Antananarivo') AT TIME ZONE 'Indian/Antananarivo' AS start,
                (date_trunc('day', now() AT TIME ZONE 'Indian/Antananarivo') + interval '1 day') AT TIME ZONE 'Indian/Antananarivo' AS stop)
       SELECT
         count(*) FILTER (WHERE e.kind IN ('call_out', 'call_in'))::int AS calls,
         count(*) FILTER (WHERE e.kind = 'call_blocked')::int AS blocked,
         count(*) FILTER (WHERE e.kind = 'unlock')::int AS unlocks,
         (SELECT count(*)::int FROM quick_messages q, day WHERE q.child_id = $1 AND q.family_id = $2 AND q.created_at >= day.start AND q.created_at < day.stop) AS messages
       FROM day LEFT JOIN device_events e
         ON e.child_id = $1 AND e.family_id = $2 AND e.started_at >= day.start AND e.started_at < day.stop`,
      [child.id, own.familyId])
    return { items, next, today: { calls: c.calls, blocked: c.blocked, messages: c.messages, unlocks: c.unlocks } }
  })
}
