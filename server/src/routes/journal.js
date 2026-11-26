// Journal de l'enfant (NAR-152) : appels sortants, reçus et bloqués, déverrouillages
// (device_events) et messages rapides (quick_messages), du plus récent au plus ancien.
//   GET /children/:id/journal?kind=all|calls|blocked|messages|unlocks&before=<curseur>&limit=&counts=1&day=AAAA-MM-JJ|today
// day (NAR-233) : un seul jour, à l'heure de Madagascar, comme les nombres du jour ; « today » : le
// jour du serveur (NAR-244). La réponse rend alors `day`, la date retenue, que l'app renvoie pour les
// pages suivantes (jamais « today » de nouveau : passé minuit, ce serait un autre jour). Sans day :
// tous les jours (accueil) et nombres d'aujourd'hui.
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
// Jour « AAAA-MM-JJ » qui existe vraiment (pas de 2026-02-30 ramené au 2 mars), année 2000 à 2999
// (l'an 0 ferait échouer PostgreSQL : 400, jamais 500).
export function parseDay(raw) {
  if (typeof raw !== 'string' || !/^2\d{3}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null
}

export async function journalRoutes(app) {
  const { db, config } = app

  app.get('/children/:id/journal', async (req) => {
    if (!isUuid(req.params.id)) throw childNotFound()
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!child) throw childNotFound()

    const kind = KINDS[typeof req.query.kind === 'string' && KINDS[req.query.kind] ? req.query.kind : 'all']
    // Jour demandé : validé avant toute lecture ; mal formé → 400 (jamais « tous les jours »).
    // « today » (NAR-244) : le jour courant du serveur à Madagascar, même horloge que les nombres
    // du jour (jamais celle du téléphone). Sans day : tous les jours (accueil).
    let day = null
    if (req.query.day === 'today') {
      const { rows: [r] } = await db.query("SELECT to_char(now() AT TIME ZONE 'Indian/Antananarivo', 'YYYY-MM-DD') AS d")
      day = r.d
    } else if (req.query.day !== undefined) {
      day = parseDay(req.query.day)
      if (!day) throw new HttpError(400, 'Jour invalide.', 'invalid_day')
    }
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
         SELECT 'event' AS source, id, kind, date_trunc('milliseconds', started_at) AS at, contact_id, name_enc, phone_enc, duration_s, unlock_source, emergency_window, NULL::smallint AS slot, NULL::bytea AS text_enc
           FROM device_events WHERE child_id = $1 AND family_id = $2 AND kind = ANY($3::text[])
         UNION ALL
         -- Millisecondes : le curseur (ISO) n'en garde pas plus ; sinon un message de la même
         -- milliseconde que le dernier de la page tomberait entre deux pages.
         SELECT 'message', id, 'message', date_trunc('milliseconds', created_at), NULL, NULL, NULL, NULL, NULL, NULL, slot, text_enc
           FROM quick_messages WHERE child_id = $1 AND family_id = $2 AND $4
       ) j
       WHERE ($5::timestamptz IS NULL OR (at, id) < ($5, $6::uuid))
         AND ($8::date IS NULL OR (at >= ($8::date::timestamp AT TIME ZONE 'Indian/Antananarivo')
                                AND at < (($8::date + 1)::timestamp AT TIME ZONE 'Indian/Antananarivo')))
       ORDER BY at DESC, id DESC LIMIT $7`,
      [child.id, own.familyId, kind.events, kind.messages, cursor[0], cursor[1], limit + 1, day])
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
        ...(r.kind === 'unlock' ? { source: r.unlock_source } : {}),
        // Appel reçu laissé sonner par la fenêtre des secours (NAR-196).
        ...(r.emergency_window ? { emergencyWindow: true } : {})
      }
    })
    const last = page.at(-1)
    const next = rows.length > limit && last ? `${last.at.toISOString()}_${last.id}` : null
    const dayOut = day ? { day } : {}
    if (cursor[0] || req.query.counts !== '1') return { items, next, ...dayOut }
    // Nombres du jour (tuiles de synthèse, NAR-175) : jour de Madagascar, borné des deux
    // côtés (un téléphone en avance ne compte jamais demain dans aujourd'hui). Seulement sur
    // demande et en première page : ils ne dépendent ni du filtre ni de la page. Jour choisi
    // (day, NAR-233) : ses nombres, rendus sous la même clé « today ».
    const { rows: [c] } = await db.query(
      `WITH d AS (SELECT COALESCE($3::date, (now() AT TIME ZONE 'Indian/Antananarivo')::date) AS v),
       day AS (
         SELECT d.v::timestamp AT TIME ZONE 'Indian/Antananarivo' AS start,
                (d.v + 1)::timestamp AT TIME ZONE 'Indian/Antananarivo' AS stop FROM d)
       SELECT
         count(*) FILTER (WHERE e.kind IN ('call_out', 'call_in'))::int AS calls,
         count(*) FILTER (WHERE e.kind = 'call_blocked')::int AS blocked,
         count(*) FILTER (WHERE e.kind = 'unlock')::int AS unlocks,
         (SELECT count(*)::int FROM quick_messages q, day WHERE q.child_id = $1 AND q.family_id = $2 AND q.created_at >= day.start AND q.created_at < day.stop) AS messages
       FROM day LEFT JOIN device_events e
         ON e.child_id = $1 AND e.family_id = $2 AND e.started_at >= day.start AND e.started_at < day.stop`,
      [child.id, own.familyId, day])
    return { items, next, ...dayOut, today: { calls: c.calls, blocked: c.blocked, messages: c.messages, unlocks: c.unlocks } }
  })
}
