// État du téléphone de l'enfant (NAR-147), règles dans ../device-status.js.
//
// Téléphone (session d'appareil, préfixe /api/device) :
//   POST /heartbeat  { batteryPct, charging, network, simState, background? } : signal de
//                    vie et relevés de CE téléphone (lu sur la session ; aucun identifiant
//                    accepté). `background` : vrai si envoyé par la surveillance native en
//                    arrière-plan (NAR-180), seule à déclencher l'alerte « silence » ;
//                    gardé ensuite (absent ou faux ne le remet jamais à faux).
//                    Accepte la session d'appareil OU le jeton « signal de vie »
//                    (`Authorization: Heartbeat <jeton>`, NAR-180), qui n'ouvre que cette route.
//   POST /heartbeat-token  session d'appareil seule : nouveau jeton « signal de vie »
//                    (256 bits), rendu une fois ; l'empreinte remplace la précédente (l'ancien
//                    jeton est refusé aussitôt). Pour le natif en arrière-plan, qui ne touche
//                    jamais à la session (pas de renouvellement croisé avec l'écran).
// Parent (session de compte, préfixe /api) :
//   GET  /children/:id/status  membres : téléphones actifs de l'enfant, relevés et alertes
//                              ouvertes ; autre famille → 404.
import { HttpError, audit, isUuid } from '../lib.js'
import { ROLES, requireOwnFamily } from '../families.js'
import { createLimiter, newToken } from '../security.js'
import { applyHeartbeat, parseHeartbeat } from '../device-status.js'

// Un signal toutes les 15 minutes, plus un tout de suite à chaque changement (batterie qui
// passe sous 15 %, carte SIM) : 5 par tranche de 5 minutes, environ un par minute.
export const HEARTBEAT_MAX = 5
export const HEARTBEAT_WINDOW_MS = 5 * 60_000
// Jeton « signal de vie » : un par démarrage de l'app appairée, ou quand le natif l'a perdu.
export const HEARTBEAT_TOKEN_MAX = 10
export const HEARTBEAT_TOKEN_WINDOW_MS = 60 * 60_000
// Validité du jeton : l'app le réémet à chaque démarrage, un téléphone utilisé le renouvelle.
export const HEARTBEAT_TOKEN_DAYS = 30

export async function deviceStatusRoutes(app) {
  const { db } = app
  const limit = createLimiter({ max: HEARTBEAT_MAX, windowMs: HEARTBEAT_WINDOW_MS })
  const tokenLimit = createLimiter({ max: HEARTBEAT_TOKEN_MAX, windowMs: HEARTBEAT_TOKEN_WINDOW_MS })
  // `heartbeat: true` : seule route où app.js accepte le jeton « signal de vie ».
  app.post('/heartbeat', { config: { device: true, heartbeat: true } }, async (req) => {
    const status = parseHeartbeat(req.body)
    if (!limit(`device:${req.device.id}`)) throw new HttpError(429, 'Trop d’envois. Réessayez dans une minute.')
    await applyHeartbeat(db, req.device, status)
    return { ok: true }
  })

  app.post('/heartbeat-token', { config: { device: true } }, async (req) => {
    if (req.body !== undefined && req.body !== null && (typeof req.body !== 'object' || Object.keys(req.body).length)) {
      throw new HttpError(400, 'Requête invalide.')
    }
    if (!tokenLimit(`device:${req.device.id}`)) throw new HttpError(429, 'Trop de demandes. Réessayez plus tard.')
    const { token, hash } = newToken()
    // Téléphone toujours actif : une révocation concurrente (ligne verrouillée) passe avant,
    // et la condition relue n'émet alors rien.
    const { rows: [device] } = await db.query(
      `UPDATE child_devices SET heartbeat_token_hash = $2, heartbeat_token_expires_at = now() + make_interval(days => $3)
        WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [req.device.id, hash, HEARTBEAT_TOKEN_DAYS])
    if (!device) throw new HttpError(401, 'Session de l’appareil expirée.')
    await audit(db, req, 'device_heartbeat_token', device.id)
    return { token }
  })
}

export async function childStatusRoutes(app) {
  const { db } = app
  const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
  app.get('/children/:id/status', async (req) => {
    if (!isUuid(req.params.id)) throw childNotFound()
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [req.params.id, own.familyId])
    if (!child) throw childNotFound()
    const { rows: devices } = await db.query(
      `SELECT id, model, battery_pct, charging, network, sim_state, status_at FROM child_devices
        WHERE child_id = $1 AND family_id = $2 AND revoked_at IS NULL ORDER BY created_at, id`, [child.id, own.familyId])
    const { rows: alerts } = devices.length ? await db.query(
      `SELECT device_id, kind, opened_at FROM device_alerts
        WHERE child_id = $1 AND family_id = $2 AND closed_at IS NULL AND device_id = ANY($3::uuid[])
        ORDER BY opened_at, kind`, [child.id, own.familyId, devices.map((d) => d.id)]) : { rows: [] }
    // Champ par champ : ni famille, ni enfant, ni version du téléphone.
    return {
      devices: devices.map((d) => ({
        id: d.id,
        model: d.model,
        batteryPct: d.battery_pct,
        charging: d.charging,
        network: d.network,
        simState: d.sim_state,
        statusAt: d.status_at,
        alerts: alerts.filter((a) => a.device_id === d.id).map((a) => ({ kind: a.kind, openedAt: a.opened_at }))
      }))
    }
  })
}
