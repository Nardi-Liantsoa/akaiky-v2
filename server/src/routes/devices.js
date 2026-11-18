// Appairage du téléphone de l'enfant (NAR-138).
//
// Côté parent (session de compte, préfixe /api) :
//   POST /children/:id/pairing   owner, manager : jeton 15 min, usage unique, et
//                                 la charge utile du QR de provisionnement Android ;
//   GET  /children/:id/devices   membres : téléphones appairés actifs ;
//   POST /devices/:id/revoke     owner, manager : révocation immédiate.
// Côté téléphone (session d'appareil, préfixe /api/device) :
//   POST /pair     public : jeton d'appairage → identifiants d'appareil ;
//   POST /refresh  public : renouvellement tourné (mécanique de native.js) ;
//   GET  /me       appareil : son identifiant et l'enfant auquel il est lié.
// Une session d'appareil n'atteint que /api/device/* et une session de compte
// jamais ces routes : le cloisonnement est posé dans app.js.
import { HttpError, audit, isUuid } from '../lib.js'
import { withTransaction } from '../db.js'
import { MANAGERS, ROLES, lockOwnFamily, requireOwnFamily } from '../families.js'
import { createLimiter, newToken, rateLimitKey, tokenHash } from '../security.js'
import { securityAlert } from '../login-guard.js'
import { openField } from '../crypto-fields.js'
import { contactAad } from './contacts.js'

export const PAIRING_MINUTES = 15
// Téléphones actifs par enfant : le sien, plus un de rechange pendant un changement.
export const MAX_DEVICES = 3
// Receveur Device Admin de l'app enfant (NAR-164) : Android le désigne Device Owner.
export const DEVICE_ADMIN_COMPONENT = 'mg.nosytech.akaiky.enfant/mg.nosytech.akaiky.AkaikyDeviceAdminReceiver'
// Session d'appareil : renouvelable 180 jours après le dernier usage, sans plafond
// absolu. Un téléphone d'enfant ne se réappaire qu'en le réinitialisant : on ne le
// déconnecte pas au bout d'un an. Contrepartie assumée : un jeton de renouvellement
// volé et tourné régulièrement reste valable tant qu'un gestionnaire ne révoque pas
// le téléphone (rejeu détecté seulement si le vrai téléphone renouvelle aussi).
export const DEVICE_REFRESH_DAYS = 180
const PREVIOUS_DAYS = 7

const PUBLIC = { config: { public: true } }

// If-None-Match : liste séparée par des virgules, validateurs faibles (W/) acceptés
// (un mandataire qui compresse affaiblit l'ETag), `*` exclu.
function matches(header, etag) {
  if (typeof header !== 'string') return false
  return header.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)
}

// Place libre pour un téléphone de plus (enfant verrouillé par l'appelant). Même
// règle au QR et à l'échange. Un téléphone dont la session ne peut plus être
// renouvelée (perdu, réinitialisé, éteint plus de 180 jours) ne garde pas sa place.
async function assertDeviceSlot(conn, childId) {
  const { rows: [{ n }] } = await conn.query(
    `SELECT count(*)::int AS n FROM child_devices d
      WHERE d.child_id = $1 AND d.revoked_at IS NULL
        AND EXISTS (SELECT 1 FROM device_sessions s WHERE s.device_id = d.id AND s.refresh_expires_at > now())`, [childId])
  if (n >= MAX_DEVICES) throw new HttpError(409, 'Nombre maximal de téléphones atteint pour cet enfant.', 'too_many_devices')
}
const childNotFound = () => new HttpError(404, 'Enfant introuvable.', 'child_not_found')
const deviceNotFound = () => new HttpError(404, 'Téléphone introuvable.', 'device_not_found')
// Même réponse pour un jeton inconnu, expiré ou déjà utilisé : rien à apprendre en sondant.
const pairingInvalid = () => new HttpError(401, 'Code d’appairage invalide ou expiré.', 'pairing_invalid')
const TOKEN = { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' }
const LABEL = { type: 'string', maxLength: 200 }
// Texte libre envoyé par le téléphone : sans caractère de contrôle, borné.
const clean = (v, max) => typeof v === 'string' ? v.replace(/[^\p{L}\p{N} ._()+/-]/gu, '').trim().slice(0, max) || null : null

const PAIR = {
  type: 'object',
  additionalProperties: false,
  required: ['token'],
  properties: { token: TOKEN, model: LABEL, osVersion: LABEL, appVersion: LABEL }
}
const REFRESH = { type: 'object', additionalProperties: false, required: ['refreshToken'], properties: { refreshToken: TOKEN } }

// Routes de compte (préfixe /api).
export async function devicesRoutes(app) {
  const { db, config } = app
  const childId = (req) => { if (!isUuid(req.params.id)) throw childNotFound(); return req.params.id }

  app.post('/children/:id/pairing', async (req, reply) => {
    const id = childId(req)
    if (!config.deviceApk) throw new HttpError(503, 'L’appairage n’est pas encore disponible sur ce serveur.', 'pairing_unavailable')
    const { token, hash } = newToken()
    const expiresAt = await withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE', [id, own.familyId])
      if (!child) throw childNotFound()
      // Plafond vérifié dès le QR : sinon le refus n'arriverait qu'après la
      // réinitialisation du téléphone, laissé configuré mais sans session.
      await assertDeviceSlot(conn, id)
      // Un seul QR valable par enfant : le nouveau remplace les précédents encore inutilisés.
      await conn.query('DELETE FROM pairing_tokens WHERE child_id = $1 AND family_id = $2 AND (used_at IS NULL OR created_at < now() - interval \'1 day\')', [id, own.familyId])
      const { rows: [row] } = await conn.query(
        `INSERT INTO pairing_tokens(token_hash, family_id, child_id, created_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5)) RETURNING expires_at`,
        [hash, own.familyId, id, req.user.id, PAIRING_MINUTES])
      await audit(conn, req, 'pairing_created', id)
      return row.expires_at
    })
    // Charge utile du QR de provisionnement Android (Device Owner). Seul secret : le
    // jeton d'appairage, 15 minutes et usage unique ; l'APK et son certificat sont publics.
    const provisioning = {
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': DEVICE_ADMIN_COMPONENT,
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': config.deviceApk.url,
      'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': config.deviceApk.signatureChecksum,
      // Téléphone, contacts et SMS du système restent disponibles pour l'app enfant ;
      // ce qui est montré à l'enfant se règle au verrouillage (NAR-139).
      'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
      'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': { 'akaiky.pairing': token, 'akaiky.api': config.origin }
    }
    return reply.code(201).send({ expiresAt, provisioning })
  })

  app.get('/children/:id/devices', async (req) => {
    const id = childId(req)
    const own = await requireOwnFamily(db, req, ROLES)
    const { rows: [child] } = await db.query('SELECT id FROM children WHERE id = $1 AND family_id = $2', [id, own.familyId])
    if (!child) throw childNotFound()
    const { rows } = await db.query(
      `SELECT id, model, os_version, app_version, created_at, last_seen_at FROM child_devices
        WHERE child_id = $1 AND family_id = $2 AND revoked_at IS NULL ORDER BY created_at, id`, [id, own.familyId])
    return rows.map((r) => ({ id: r.id, model: r.model, osVersion: r.os_version, appVersion: r.app_version, createdAt: r.created_at, lastSeenAt: r.last_seen_at }))
  })

  app.post('/devices/:id/revoke', async (req) => {
    if (!isUuid(req.params.id)) throw deviceNotFound()
    await withTransaction(db, async (conn) => {
      const own = await lockOwnFamily(conn, req, MANAGERS)
      const { rows: [device] } = await conn.query(
        'UPDATE child_devices SET revoked_at = now() WHERE id = $1 AND family_id = $2 AND revoked_at IS NULL RETURNING id',
        [req.params.id, own.familyId])
      if (!device) throw deviceNotFound()
      // Ses sessions tombent tout de suite : la requête suivante du téléphone reçoit 401.
      await conn.query('DELETE FROM device_sessions WHERE device_id = $1', [device.id])
      await audit(conn, req, 'device_revoked', device.id)
    })
    return { ok: true }
  })
}

// Routes du téléphone (préfixe /api/device).
export async function deviceSessionRoutes(app) {
  const { db, config } = app
  // Jeton de 256 bits : la limite par IP freine seulement un sondage aveugle. Large
  // (100 par 15 min au moins) : plusieurs téléphones s'appairent derrière un même NAT.
  const pairLimit = createLimiter({ max: Math.max(100, config.limits.perIp), windowMs: 15 * 60000 })
  const tokens = (access, refresh) => ({
    accessToken: access, refreshToken: refresh, expiresIn: config.native.accessMinutes * 60
  })

  app.post('/pair', { ...PUBLIC, schema: { body: PAIR } }, async (req, reply) => {
    if (!pairLimit(rateLimitKey(req.ip))) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.')
    const b = req.body
    const access = newToken(), refresh = newToken()
    const result = await withTransaction(db, async (conn) => {
      // Consommation atomique : deux échanges simultanés du même jeton, un seul succès.
      const { rows: [used] } = await conn.query(
        `UPDATE pairing_tokens SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING family_id, child_id`, [tokenHash(b.token)])
      if (!used) throw pairingInvalid()
      // Enfant verrouillé : le plafond d'appareils tient sous deux appairages simultanés.
      const { rows: [child] } = await conn.query('SELECT id FROM children WHERE id = $1 AND family_id = $2 FOR UPDATE', [used.child_id, used.family_id])
      if (!child) throw pairingInvalid()
      await assertDeviceSlot(conn, child.id)
      const { rows: [device] } = await conn.query(
        `INSERT INTO child_devices(family_id, child_id, model, os_version, app_version) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [used.family_id, child.id, clean(b.model, 80), clean(b.osVersion, 40), clean(b.appVersion, 40)])
      await conn.query(
        `INSERT INTO device_sessions(token_hash, device_id, expires_at, refresh_hash, refresh_expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3), $4, now() + make_interval(days => $5))`,
        [access.hash, device.id, config.native.accessMinutes, refresh.hash, DEVICE_REFRESH_DAYS])
      await audit(conn, req, 'device_paired', device.id, { childId: child.id })
      return { device: { id: device.id }, child: { id: child.id } }
    })
    return reply.code(201).send({ ...result, ...tokens(access.token, refresh.token) })
  })

  // Même rotation que /api/auth/native/refresh (voir native.js), sur les sessions
  // d'appareil, seulement pour un appareil non révoqué, et sans plafond absolu.
  app.post('/refresh', { ...PUBLIC, schema: { body: REFRESH } }, async (req) => {
    const hash = tokenHash(req.body.refreshToken)
    const access = newToken(), refresh = newToken()
    const { rows } = await db.query(
      `UPDATE device_sessions s SET token_hash = $2, expires_at = now() + make_interval(mins => $4),
              refresh_hash = $3, last_seen_at = now(),
              previous_refresh_hash = CASE WHEN s.refresh_hash = $1 THEN s.refresh_hash END,
              discarded_refresh_hash = CASE WHEN s.refresh_hash = $1 THEN s.discarded_refresh_hash ELSE s.refresh_hash END,
              rotated_at = CASE WHEN s.refresh_hash = $1 THEN now() ELSE s.rotated_at END,
              refresh_expires_at = now() + make_interval(days => $5)
         FROM child_devices d
        WHERE s.refresh_expires_at > now()
          AND (s.refresh_hash = $1 OR (s.previous_refresh_hash = $1 AND s.rotated_at > now() - make_interval(days => $6)))
          AND d.id = s.device_id AND d.revoked_at IS NULL
        RETURNING d.id`,
      [hash, access.hash, refresh.hash, config.native.accessMinutes, DEVICE_REFRESH_DAYS, PREVIOUS_DAYS])
    if (rows[0]) return tokens(access.token, refresh.token)
    // Successeur écarté présenté : deux détenteurs pour une session. Fermée, signalée.
    const replayed = (await db.query('DELETE FROM device_sessions WHERE discarded_refresh_hash = $1 RETURNING device_id', [hash])).rows[0]
    if (replayed) {
      await audit(db, req, 'device_refresh_replay', replayed.device_id)
      await securityAlert(db, 'device_refresh_replay')
    }
    throw new HttpError(401, 'Session de l’appareil expirée.')
  })

  // Configuration du téléphone (NAR-160) : contacts autorisés de SON enfant, lu sur la
  // session (jamais un identifiant envoyé par le téléphone). ETag = enfant + version :
  // une configuration d'un autre enfant (téléphone réappairé) ne vaut jamais 304.
  // Le 304 ne coûte qu'une lecture ; version et liste ne sont lues ensemble, dans une
  // même photo de la base, que lorsqu'elles ont changé.
  app.get('/config', { config: { device: true } }, async (req, reply) => {
    const tagOf = (version) => `"${req.device.childId}.${version}"`
    if (req.headers['if-none-match']) {
      const { rows: [current] } = await db.query(
        'SELECT config_version FROM children WHERE id = $1 AND family_id = $2', [req.device.childId, req.device.familyId])
      if (!current) throw new HttpError(401, 'Session de l’appareil expirée.')
      if (matches(req.headers['if-none-match'], tagOf(current.config_version))) {
        return reply.header('etag', tagOf(current.config_version)).code(304).send()
      }
    }
    return withTransaction(db, async (conn) => {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      const { rows: [child] } = await conn.query(
        'SELECT config_version FROM children WHERE id = $1 AND family_id = $2', [req.device.childId, req.device.familyId])
      if (!child) throw new HttpError(401, 'Session de l’appareil expirée.')
      reply.header('etag', tagOf(child.config_version))
      const { rows } = await conn.query(
        `SELECT id, name_enc, phone_enc, position, avatar_color FROM allowed_contacts
          WHERE child_id = $1 AND family_id = $2 ORDER BY position`, [req.device.childId, req.device.familyId])
      // Champ par champ : ni membre lié ni rôle, seulement ce que le téléphone affiche et appelle.
      return {
        version: Number(child.config_version),
        // Pays des numéros (MG, FR) : numéro d'urgence affiché par le téléphone (NAR-142).
        country: config.phoneCountry,
        contacts: rows.map((r) => ({
          id: r.id,
          name: openField(r.name_enc, config.dataKey, contactAad(r.id, 'name')),
          phone: openField(r.phone_enc, config.dataKey, contactAad(r.id, 'phone')),
          position: r.position,
          avatarColor: r.avatar_color
        }))
      }
    })
  })

  app.get('/me', { config: { device: true } }, async (req) => {
    const { rows: [child] } = await db.query(
      'SELECT id, first_name_enc FROM children WHERE id = $1 AND family_id = $2', [req.device.childId, req.device.familyId])
    if (!child) throw new HttpError(401, 'Session de l’appareil expirée.')
    return {
      device: { id: req.device.id },
      child: { id: child.id, firstName: openField(child.first_name_enc, config.dataKey, `children:first_name:${child.id}`) }
    }
  })
}
