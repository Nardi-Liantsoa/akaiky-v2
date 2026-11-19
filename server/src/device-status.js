// État du téléphone de l'enfant (NAR-147) : relevés envoyés par le téléphone (batterie,
// réseau, carte SIM) et alertes de la famille.
//
// Règles (une alerte ouverte au plus par téléphone et par type, index unique partiel de
// 020_device_status.sql ; la famille est prévenue à l'ouverture seulement) :
//   battery_low  batterie < 15 % hors charge → ouverte ; ≥ 20 % → fermée (hystérésis :
//                entre 15 et 19 %, rien ne change ; la charge seule ne la ferme pas, elle
//                empêche seulement d'en ouvrir une). Fermée depuis moins de 60 minutes sur
//                ce téléphone : aucune nouvelle alerte ni notification (batterie qui oscille
//                autour du seuil) ;
//   sim_absent   carte SIM absente → ouverte ; prête → fermée (verrouillée ou inconnue :
//                rien ne change) ;
//   silent       aucun signal depuis 60 minutes (tâche de jobs.js) → ouverte ; le signal
//                suivant la ferme, sans notification. Seuls les téléphones dont le dernier
//                signal vient de la surveillance native en arrière-plan (background = true,
//                NAR-180) sont surveillés : l'app au premier plan seule s'arrête dès que
//                l'enfant la quitte, ce serait une fausse alerte.
// Un téléphone qui n'a jamais envoyé de signal (status_at NULL) n'est jamais « silencieux ».
import { HttpError } from './lib.js'
import { withTransaction } from './db.js'
import { notifyFamily } from './push.js'

export const BATTERY_LOW = 15
export const BATTERY_OK = 20
export const SILENT_MINUTES = 60
export const BATTERY_COOLDOWN_MINUTES = 60
export const SILENT_EVERY_MS = 5 * 60_000
export const NETWORKS = ['wifi', 'mobile', 'none', 'unknown']
export const SIM_STATES = ['ready', 'absent', 'locked', 'unknown']
const FIELDS = ['batteryPct', 'charging', 'network', 'simState', 'background']

// Corps du signal, vérifié champ par champ : les quatre champs exigés, `background`
// facultatif (faux par défaut), rien d'autre (aucun identifiant de téléphone ni d'enfant :
// ils viennent de la session). Batterie et charge peuvent être inconnues (null), le réseau
// et la carte SIM 'unknown'.
export function parseHeartbeat(b) {
  const invalid = (field) => new HttpError(400, `${field} invalide.`, 'invalid_heartbeat')
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Requête invalide.', 'invalid_heartbeat')
  const unknown = Object.keys(b).filter((k) => !FIELDS.includes(k))
  if (unknown.length) throw new HttpError(400, `Champ non accepté : ${unknown.join(', ')}`, 'invalid_heartbeat')
  const { batteryPct, charging, network, simState, background = false } = b
  if (batteryPct !== null && !(Number.isInteger(batteryPct) && batteryPct >= 0 && batteryPct <= 100)) throw invalid('batteryPct')
  if (charging !== null && typeof charging !== 'boolean') throw invalid('charging')
  if (!NETWORKS.includes(network)) throw invalid('network')
  if (!SIM_STATES.includes(simState)) throw invalid('simState')
  if (typeof background !== 'boolean') throw invalid('background')
  return { batteryPct, charging, network, simState, background }
}

// Ouvre l'alerte si aucune n'est ouverte pour ce téléphone et ce type ; renvoie vrai si
// elle vient d'être ouverte (la famille est alors prévenue, une seule fois).
async function openAlert(conn, device, kind) {
  const { rowCount } = await conn.query(
    `INSERT INTO device_alerts(family_id, child_id, device_id, kind) VALUES ($1, $2, $3, $4)
     ON CONFLICT (device_id, kind) WHERE closed_at IS NULL DO NOTHING`,
    [device.familyId, device.childId, device.id, kind])
  if (rowCount) await notifyFamily(conn, device.familyId, kind, device.childId)
  return rowCount > 0
}
// Alerte de ce type fermée sur ce téléphone depuis moins de 60 minutes (batterie).
async function recentlyClosed(conn, deviceId, kind) {
  const { rows } = await conn.query(
    `SELECT 1 FROM device_alerts WHERE device_id = $1 AND kind = $2
        AND closed_at > now() - make_interval(mins => $3) LIMIT 1`, [deviceId, kind, BATTERY_COOLDOWN_MINUTES])
  return rows.length > 0
}
const closeAlerts = (conn, deviceId, kinds) => conn.query(
  'UPDATE device_alerts SET closed_at = now() WHERE device_id = $1 AND kind = ANY($2::text[]) AND closed_at IS NULL', [deviceId, kinds])

// Enregistre le signal et applique les règles, en une transaction. `device` : la session
// d'appareil (id, familyId, childId), jamais un identifiant envoyé par le téléphone.
export function applyHeartbeat(db, device, s) {
  return withTransaction(db, async (conn) => {
    // Téléphone verrouillé : deux signaux simultanés (ou la tâche « silence ») passent
    // l'un après l'autre. Révoqué entre-temps : refusé.
    // `background_status` ne fait que passer à vrai : un signal de premier plan (sans
    // `background`) ne lève jamais la surveillance posée par le signal natif (NAR-180),
    // sinon l'app ouverte une fois suffirait à couper l'alerte « silence ». Il ne repart à
    // faux qu'au réappairage : chaque appairage crée une nouvelle ligne child_devices, à faux.
    const { rowCount } = await conn.query(
      `UPDATE child_devices SET battery_pct = $2, charging = $3, network = $4, sim_state = $5, background_status = background_status OR $8, status_at = now()
        WHERE id = $1 AND family_id = $6 AND child_id = $7 AND revoked_at IS NULL`,
      [device.id, s.batteryPct, s.charging, s.network, s.simState, device.familyId, device.childId, s.background])
    if (!rowCount) throw new HttpError(401, 'Session de l’appareil expirée.')
    const opened = []
    const close = ['silent']
    if (s.batteryPct !== null && s.batteryPct < BATTERY_LOW && s.charging !== true) {
      if (!await recentlyClosed(conn, device.id, 'battery_low') && await openAlert(conn, device, 'battery_low')) opened.push('battery_low')
    } else if (s.batteryPct !== null && s.batteryPct >= BATTERY_OK) close.push('battery_low')
    if (s.simState === 'absent') {
      if (await openAlert(conn, device, 'sim_absent')) opened.push('sim_absent')
    } else if (s.simState === 'ready') close.push('sim_absent')
    await closeAlerts(conn, device.id, close)
    return opened
  })
}

// Tâche « silence » (jobs.js, toutes les 5 minutes) : une alerte par téléphone actif,
// surveillé en arrière-plan (background_status), dont le dernier signal date de plus de
// 60 minutes, et qui n'en a pas déjà une ouverte. Une seule instance à la fois (verrou
// consultatif de transaction : une autre instance passe son tour). Renvoie le nombre d'alertes ouvertes, ou null si le tour est passé.
export function runSilentWatch(db) {
  return withTransaction(db, async (conn) => {
    const { rows: [lock] } = await conn.query("SELECT pg_try_advisory_xact_lock(hashtext('akaiky:silent')) AS ok")
    if (!lock.ok) return null
    const { rows } = await conn.query(
      `INSERT INTO device_alerts(family_id, child_id, device_id, kind)
       SELECT d.family_id, d.child_id, d.id, 'silent' FROM child_devices d
        WHERE d.revoked_at IS NULL AND d.status_at IS NOT NULL AND d.background_status
          AND d.status_at < now() - make_interval(mins => $1)
          AND NOT EXISTS (SELECT 1 FROM device_alerts a WHERE a.device_id = d.id AND a.kind = 'silent' AND a.closed_at IS NULL)
        ORDER BY d.id
        -- Signal en cours d'écriture : passé (il ferme l'alerte de toute façon) ; sinon la
        -- ligne verrouillée est relue, jamais d'alerte sur un signal tout juste arrivé.
        FOR UPDATE OF d SKIP LOCKED
       ON CONFLICT (device_id, kind) WHERE closed_at IS NULL DO NOTHING
       RETURNING family_id, child_id`, [SILENT_MINUTES])
    for (const r of rows) await notifyFamily(conn, r.family_id, 'silent', r.child_id)
    return rows.length
  })
}
