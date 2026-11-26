// Notifications push (NAR-141, skill ampy-push). Seul le serveur envoie : FCM HTTP v1 en
// direct (Android, et iOS par la clé APNs déposée dans Firebase), sans dépendance : le
// jeton OAuth du compte de service est un JWT RS256 signé ici (node:crypto) et échangé
// contre un jeton d'accès Google.
//
// Chemin d'une notification :
//   1. enqueue (notifyFamily, notifyDevice, notifySession), dans la transaction de
//      l'événement : une ligne push_outbox par jeton, sans contenu (type et identifiant) ;
//   2. runPushWorker (jobs.js, toutes les 10 s) : réserve les lignes dues (FOR UPDATE SKIP
//      LOCKED, tentative comptée en base), construit le texte à l'envoi (push-texts.js),
//      envoie hors transaction, puis note l'issue. Jeton mort (UNREGISTERED, ou
//      INVALID_ARGUMENT sur le jeton) → supprimé ; erreur temporaire ou de configuration
//      → nouvelle tentative (30 s × 2^n, ou plus si FCM envoie Retry-After, au plus 1 h),
//      abandon après 5. Ligne dont le jeton a disparu (token_id NULL) → abandonnée.
import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { blindIndex, openField, sealField } from './crypto-fields.js'
import { withTransaction } from './db.js'
import { SESSION_RULE } from './lib.js'
import { CHILD_EVENTS, SOS_EVENTS, buildPayload, kindOf } from './push-texts.js'

export const PUSH_EVERY_MS = 10_000
export const MAX_ATTEMPTS = 5
export const RETRY_BASE_S = 30
// Retry-After de FCM (429, 503) : suivi, mais jamais plus d'une heure.
export const RETRY_AFTER_MAX_S = 3600
// Plafond par compte (tous ses jetons confondus) et par téléphone d'enfant : un bug de
// boucle n'arrose jamais personne.
export const PER_OWNER_PER_HOUR = 30
// Réveil `locate` (NAR-203) : plus de nouvelle tentative au-delà d'une consultation.
export const LOCATE_RETRY_MS = 2 * 60_000
// Délai de réservation : une instance tuée pendant l'envoi rend la ligne après ce délai.
const LEASE = '5 minutes'

export const tokenAad = (id) => `push_tokens:token:${id}`
export const tokenIndex = (config, token) => blindIndex(token, config.dataKey, 'push-token')

// ---------------------------------------------------------------- compte de service FCM

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

// FCM_SERVICE_ACCOUNT : le JSON lui-même, ou le chemin absolu d'un fichier monté HORS du
// dépôt. Invalide → le démarrage s'arrête. Les messages d'erreur ne citent jamais la clé.
export function loadServiceAccount(value) {
  if (!value) throw new Error('FCM_SERVICE_ACCOUNT requis avec PUSH_PROVIDER=fcm (JSON du compte de service, ou chemin d’un fichier hors du dépôt)')
  let raw = value.trim()
  if (!raw.startsWith('{')) {
    const path = resolve(raw)
    if (raw !== path) throw new Error('FCM_SERVICE_ACCOUNT : chemin absolu attendu')
    if ((path + sep).startsWith(REPO_ROOT)) throw new Error('FCM_SERVICE_ACCOUNT : le fichier doit être hors du dépôt')
    try { raw = readFileSync(path, 'utf8') } catch { throw new Error('FCM_SERVICE_ACCOUNT : fichier illisible') }
  }
  let sa
  try { sa = JSON.parse(raw) } catch { throw new Error('FCM_SERVICE_ACCOUNT : JSON invalide') }
  if (sa?.type !== 'service_account') throw new Error('FCM_SERVICE_ACCOUNT : compte de service attendu (type service_account)')
  if (typeof sa.project_id !== 'string' || !/^[a-z][a-z0-9-]{4,38}[a-z0-9]$/.test(sa.project_id)) throw new Error('FCM_SERVICE_ACCOUNT : project_id invalide')
  if (typeof sa.client_email !== 'string' || !/^[^\s@]+@[a-z0-9.-]+$/i.test(sa.client_email)) throw new Error('FCM_SERVICE_ACCOUNT : client_email invalide')
  if ((sa.token_uri ?? GOOGLE_TOKEN_URI) !== GOOGLE_TOKEN_URI) throw new Error('FCM_SERVICE_ACCOUNT : token_uri inattendu')
  let privateKey
  try { privateKey = createPrivateKey(sa.private_key) } catch { throw new Error('FCM_SERVICE_ACCOUNT : private_key illisible') }
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('FCM_SERVICE_ACCOUNT : clé RSA attendue')
  return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey }
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

// Assertion OAuth 2.0 du compte de service (RFC 7523), valable une heure.
export function signJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64url({ alg: 'RS256', typ: 'JWT' })
  const claims = b64url({ iss: sa.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URI, iat: nowSec, exp: nowSec + 3600 })
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), sa.privateKey).toString('base64url')
  return `${head}.${claims}.${signature}`
}

export const fcmSendUrl = (sa) => `https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`
export const fcmRequestBody = (token, message) => ({ message: { ...message, token } })

// Issue d'une réponse FCM. Seuls le statut HTTP et le code FCM sont gardés (jamais le
// message d'erreur, qui pourrait reprendre le jeton). Un jeton n'est supprimé que si FCM
// le dit mort (UNREGISTERED) ou invalide (INVALID_ARGUMENT qui nomme le jeton) ; un défaut
// de configuration (SENDER_ID_MISMATCH : jeton d'un autre projet Firebase, 404 sans
// UNREGISTERED : projet introuvable, 401/403 : compte de service refusé) n'est pas un
// défaut du jeton : nouvelle tentative, puis abandon, et alarme (`config`). Seul un 401
// UNAUTHENTICATED (jeton d'accès Google expiré ou révoqué) fait oublier le jeton d'accès
// (`auth`) ; THIRD_PARTY_AUTH_ERROR (401 aussi : clé APNs refusée) est un défaut de
// configuration côté Firebase, le jeton d'accès reste bon. 429 et 503 : `retryAfterS` (en-tête
// Retry-After, secondes ou date HTTP) s'il est donné.
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (/^\d+$/.test(text)) return Number(text)
  const at = Date.parse(text)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - nowMs) / 1000))
}

export function classifyFcm(status, body, { retryAfter = null, nowMs = Date.now() } = {}) {
  if (status >= 200 && status < 300) return { ok: true }
  const err = body?.error ?? {}
  const details = Array.isArray(err.details) ? err.details : []
  const fcmCode = details.find((d) => typeof d?.errorCode === 'string')?.errorCode
  const code = fcmCode || (typeof err.status === 'string' ? err.status : '')
  const error = `fcm ${status}${code ? ` ${code}` : ''}`.slice(0, 200)
  if (code === 'UNREGISTERED') return { ok: false, outcome: 'unregistered', error }
  if (code === 'SENDER_ID_MISMATCH' || status === 404 || status === 401 || status === 403) {
    return { ok: false, outcome: 'retry', error, config: true, auth: status === 401 && code === 'UNAUTHENTICATED' }
  }
  if (status === 400 || code === 'INVALID_ARGUMENT') {
    // Seulement si c'est le jeton qui est en cause, pas la charge utile.
    const fields = details.flatMap((d) => Array.isArray(d?.fieldViolations) ? d.fieldViolations : [])
    const texts = [err.message, ...details.map((d) => d?.description), ...fields.map((f) => f?.description)]
    const aboutToken = fields.some((f) => f?.field === 'message.token')
      || texts.some((t) => /registration[ -]token/i.test(String(t ?? '')))
    return { ok: false, outcome: aboutToken ? 'invalid_token' : 'fail', error }
  }
  if (status === 429 || status >= 500) {
    const retryAfterS = status === 429 || status === 503 ? parseRetryAfter(retryAfter, nowMs) : null
    return retryAfterS == null ? { ok: false, outcome: 'retry', error } : { ok: false, outcome: 'retry', error, retryAfterS }
  }
  return { ok: false, outcome: 'fail', error }
}

export function createFcmProvider(sa, { fetch = globalThis.fetch, timeoutMs = 10_000, now = () => Date.now() } = {}) {
  let access = null // { token, until }
  let pending = null // demande de jeton en cours : partagée par les envois simultanés
  async function fetchAccessToken() {
    const res = await fetch(GOOGLE_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa, Math.floor(now() / 1000)) }).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || typeof json.access_token !== 'string') throw Object.assign(new Error(`oauth ${res.status}`), { oauth: true })
    access = { token: json.access_token, until: now() + Math.max(60, (Number(json.expires_in) || 3600) - 120) * 1000 }
    return access.token
  }
  function accessToken() {
    if (access && access.until > now()) return Promise.resolve(access.token)
    // Échec : la promesse est oubliée, l'envoi suivant redemande.
    pending ??= fetchAccessToken().finally(() => { pending = null })
    return pending
  }
  return {
    name: 'fcm',
    async send(token, message) {
      try {
        const res = await fetch(fcmSendUrl(sa), {
          method: 'POST',
          headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
          body: JSON.stringify(fcmRequestBody(token, message)),
          signal: AbortSignal.timeout(timeoutMs)
        })
        const result = classifyFcm(res.status, await res.json().catch(() => null), { retryAfter: res.headers?.get?.('retry-after'), nowMs: now() })
        if (result.auth) access = null
        return result
      } catch (e) {
        // Réseau, délai dépassé, jeton d'accès refusé : temporaire.
        return { ok: false, outcome: 'retry', error: e.oauth ? e.message : 'fcm network', config: Boolean(e.oauth) }
      }
    }
  }
}

// Fournisseur factice (développement, tests ; refusé en production par config.js) : garde
// les envois en mémoire. `failNext('unregistered' | 'invalid_token' | 'retry' | 'fail', …)`
// fait répondre les envois suivants par ces issues, dans l'ordre (ou un objet résultat
// complet, par exemple { outcome: 'retry', retryAfterS: 600 }).
export function createFakeProvider() {
  const sent = [], script = []
  return {
    name: 'fake',
    sent,
    failNext(...outcomes) { script.push(...outcomes) },
    async send(token, message) {
      await new Promise((r) => setImmediate(r))
      const outcome = script.shift()
      if (outcome && typeof outcome === 'object') return { ok: false, error: `fake ${outcome.outcome}`, ...outcome }
      if (outcome) return { ok: false, outcome, error: `fake ${outcome}` }
      sent.push({ token, message })
      return { ok: true }
    }
  }
}

// PUSH_PROVIDER=none : rien ne part, la file se vide (abandon, purgé à 7 jours).
const noneProvider = { name: 'none', async send() { return { ok: false, outcome: 'fail', error: 'push_disabled' } } }

export function createPushProvider(push) {
  if (push.provider === 'fcm') return createFcmProvider(push.serviceAccount)
  if (push.provider === 'fake') return createFakeProvider()
  return noneProvider
}

// ---------------------------------------------------------------- jetons

// Enregistre le jeton pour CE propriétaire (session de compte ou téléphone), jamais un
// autre. Un jeton déjà connu ailleurs change de propriétaire : l'ancienne ligne est
// supprimée (sa file n'est plus envoyée : token_id à NULL), il n'est jamais dupliqué. Un seul
// jeton par session ou téléphone (index uniques) : un jeton rafraîchi remplace le précédent.
// Dans une transaction.
export async function registerToken(conn, config, owner, { token, platform, lang }) {
  const index = tokenIndex(config, token)
  const sessionId = owner.sessionId ?? null, deviceId = owner.deviceId ?? null, familyId = owner.familyId ?? null
  // Verrous toujours dans le même ordre, propriétaire puis jeton : deux enregistrements
  // simultanés pour la même session (ou le même téléphone), ou du même jeton, passent l'un
  // après l'autre, sans interblocage.
  await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 141))', [sessionId ? `session:${sessionId}` : `device:${deviceId}`])
  await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 141))', [index.toString('hex')])
  await conn.query(
    `DELETE FROM push_tokens WHERE token_index = $1
        AND (session_id IS DISTINCT FROM $2::uuid OR device_id IS DISTINCT FROM $3::uuid)`, [index, sessionId, deviceId])
  await conn.query(
    'DELETE FROM push_tokens WHERE token_index <> $1 AND (session_id = $2::uuid OR device_id = $3::uuid)', [index, sessionId, deviceId])
  const id = randomUUID()
  const { rows: [row] } = await conn.query(
    `INSERT INTO push_tokens(id, session_id, device_id, family_id, platform, lang, token_enc, token_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (token_index) DO UPDATE SET platform = EXCLUDED.platform, lang = EXCLUDED.lang, last_seen_at = now()
     RETURNING id`,
    [id, sessionId, deviceId, familyId, platform, lang, sealField(token, config.dataKey, tokenAad(id)), index])
  return row.id
}

// Supprime le jeton s'il appartient à CE propriétaire ; renvoie vrai s'il existait.
export async function unregisterToken(db, config, owner, token) {
  const { rowCount } = await db.query(
    'DELETE FROM push_tokens WHERE token_index = $1 AND (session_id = $2::uuid OR device_id = $3::uuid)',
    [tokenIndex(config, token), owner.sessionId ?? null, owner.deviceId ?? null])
  return rowCount > 0
}

// ---------------------------------------------------------------- file d'envoi

// Une ligne par jeton ciblé (`targets` : requête qui renvoie `id` = push_tokens.id et
// `owner` = 'user:<id>' pour un compte, 'device:<id>' pour un téléphone ('device:<id>:locate'
// pour ses réveils `locate`), écrit dans
// owner_key). Plafond par PROPRIÉTAIRE : au plus PER_OWNER_PER_HOUR lignes par heure, tous
// jetons du compte (ou du téléphone) confondus, comptées par owner_key (les lignes restent
// quand le jeton disparaît : se déconnecter puis réenregistrer ne remet pas le compteur à
// zéro), sous un verrou consultatif par propriétaire pour que deux événements simultanés ne
// le dépassent pas. Dans une transaction (ouverte ici si `conn`
// est le pool) ; renvoie { targets, queued }.
async function enqueue(conn, targets, params, event, ref) {
  if (conn instanceof pg.Pool) return withTransaction(conn, (c) => enqueue(c, targets, params, event, ref))
  const { rows: found } = await conn.query(targets, params)
  if (!found.length) return { targets: 0, queued: 0 }
  // Verrous dans un ordre fixe : deux envois croisés ne s'interbloquent pas.
  const owners = [...new Set(found.map((t) => t.owner))].sort()
  for (const owner of owners) await conn.query("SELECT pg_advisory_xact_lock(hashtext('push:' || $1))", [owner])
  // Lu après les verrous : les envois concurrents déjà validés sont comptés.
  const { rows: usage } = await conn.query(
    `SELECT owner_key AS owner, count(*)::int AS n FROM push_outbox
      WHERE owner_key = ANY($1::text[]) AND created_at > now() - interval '1 hour'
      GROUP BY owner_key`, [owners])
  const left = new Map(owners.map((o) => [o, PER_OWNER_PER_HOUR]))
  for (const u of usage) left.set(u.owner, Math.max(0, PER_OWNER_PER_HOUR - u.n))
  const allowed = []
  for (const t of found) {
    const n = left.get(t.owner)
    if (n > 0) { allowed.push(t); left.set(t.owner, n - 1) }
  }
  // Jeton supprimé entre la lecture et l'ajout : écarté, pas d'erreur de clé étrangère.
  const { rowCount } = allowed.length ? await conn.query(
    `INSERT INTO push_outbox(token_id, owner_key, kind, event, ref)
     SELECT t.id, a.owner, $3, $4, $5::uuid
       FROM unnest($1::uuid[], $2::text[]) AS a(id, owner) JOIN push_tokens t ON t.id = a.id`,
    [allowed.map((t) => t.id), allowed.map((t) => t.owner), kindOf(event), event, ref]) : { rowCount: 0 }
  return { targets: found.length, queued: rowCount }
}

// Sessions encore valables des membres de la famille (sauf `exceptUserId`) : même règle
// que le hook de session (SESSION_RULE : adresse confirmée, second facteur vérifié là où
// il est exigé), et session renouvelable.
// Les SOS (NAR-248) ont leur propre plafond horaire par compte ('user:<id>:sos') : des
// messages ou des alertes de batterie n'en privent jamais un parent.
export function notifyFamily(conn, familyId, event, ref = null, { exceptUserId = null } = {}) {
  const suffix = SOS_EVENTS.has(event) ? ':sos' : ''
  return enqueue(conn,
    `SELECT t.id, 'user:' || s.user_id || $3::text AS owner FROM push_tokens t
       JOIN sessions s ON s.id = t.session_id
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = s.user_id AND m.family_id = $1
      WHERE COALESCE(s.refresh_expires_at, s.expires_at) > now() AND ${SESSION_RULE}
        AND ($2::uuid IS NULL OR s.user_id <> $2::uuid)
      ORDER BY t.id`,
    [familyId, exceptUserId, suffix], event, ref)
}

// Téléphone de l'enfant (non révoqué). Réveils silencieux : `config` (prêt, pas encore branché),
// `locate` (demande de position, NAR-203) ; reçus par l'app avec NAR-179.
export function notifyDevice(conn, deviceId, event, ref = null) {
  return enqueue(conn,
    // `locate` a son propre plafond horaire : une consultation longue n'épuise pas celui des
    // autres réveils du téléphone.
    `SELECT t.id, 'device:' || t.device_id || CASE WHEN $2::text = 'locate' THEN ':locate' ELSE '' END AS owner FROM push_tokens t
       JOIN child_devices d ON d.id = t.device_id AND d.family_id = t.family_id
      WHERE t.device_id = $1 AND d.revoked_at IS NULL`, [deviceId, event], event, ref)
}

// La seule session donnée (notification de test).
export function notifySession(conn, sessionId, event) {
  return enqueue(conn,
    `SELECT t.id, 'user:' || s.user_id AS owner FROM push_tokens t JOIN sessions s ON s.id = t.session_id
      WHERE t.session_id = $1`, [sessionId], event, null)
}

// ---------------------------------------------------------------- worker

const childAad = (id) => `children:first_name:${id}`

// Délai avant la tentative suivante : 30 s × 2^(n-1), ou le Retry-After de FCM s'il est plus
// long (borné à une heure).
export function retryDelay(attempts, retryAfterS = null) {
  const backoff = RETRY_BASE_S * 2 ** (attempts - 1)
  const after = Number.isFinite(retryAfterS) && retryAfterS > 0 ? Math.min(retryAfterS, RETRY_AFTER_MAX_S) : 0
  return Math.max(backoff, after)
}

// Un tour : au plus `batch` lignes dues. Renvoie le décompte (sans jeton ni contenu).
export async function runPushWorker(db, provider, config, log, { batch = 50, concurrency = 5 } = {}) {
  // Réservation en une instruction (transaction courte) : tentative comptée tout de suite,
  // ligne écartée des autres instances pendant l'envoi.
  const { rows: claimed } = await db.query(
    `UPDATE push_outbox o SET attempts = o.attempts + 1, next_attempt_at = now() + interval '${LEASE}'
      WHERE o.id IN (SELECT id FROM push_outbox WHERE status = 'pending' AND next_attempt_at <= now()
                      ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.token_id, o.event, o.ref, o.attempts,
                (o.event = 'locate' AND o.created_at < now() - make_interval(secs => $2)) AS late`, [batch, LOCATE_RETRY_MS / 1000])
  const summary = { claimed: claimed.length, sent: 0, retried: 0, failed: 0, removedTokens: 0 }
  if (!claimed.length) return summary

  const { rows: tokens } = await db.query(
    `SELECT t.id, t.token_enc, t.lang, t.session_id, t.device_id, t.family_id, s.user_id
       FROM push_tokens t LEFT JOIN sessions s ON s.id = t.session_id WHERE t.id = ANY($1::uuid[])`,
    [[...new Set(claimed.map((c) => c.token_id).filter(Boolean))]])
  const tokenById = new Map(tokens.map((t) => [t.id, t]))
  const refs = claimed.filter((c) => c.event === 'message' && c.ref).map((c) => c.ref)
  const { rows: messages } = refs.length ? await db.query(
    `SELECT q.id, q.family_id, c.id AS child_id, c.first_name_enc FROM quick_messages q
       JOIN children c ON c.id = q.child_id AND c.family_id = q.family_id WHERE q.id = ANY($1::uuid[])`, [refs]) : { rows: [] }
  const messageById = new Map(messages.map((m) => [m.id, m]))
  // État du téléphone (NAR-147) : la ressource est l'enfant lui-même.
  const childRefs = claimed.filter((c) => CHILD_EVENTS.has(c.event) && c.ref).map((c) => c.ref)
  const { rows: kids } = childRefs.length ? await db.query(
    'SELECT id AS child_id, family_id, first_name_enc FROM children WHERE id = ANY($1::uuid[])', [childRefs]) : { rows: [] }
  const childById = new Map(kids.map((k) => [k.child_id, k]))
  // Alerte SOS (NAR-248) : prénom de son enfant.
  const sosRefs = claimed.filter((c) => SOS_EVENTS.has(c.event) && c.ref).map((c) => c.ref)
  const { rows: alerts } = sosRefs.length ? await db.query(
    `SELECT a.id, a.family_id, c.id AS child_id, c.first_name_enc FROM sos_alerts a
       JOIN children c ON c.id = a.child_id AND c.family_id = a.family_id WHERE a.id = ANY($1::uuid[])`, [sosRefs]) : { rows: [] }
  const sosById = new Map(alerts.map((a) => [a.id, a]))
  const userIds = [...new Set(tokens.map((t) => t.user_id).filter(Boolean))]
  const { rows: members } = userIds.length ? await db.query('SELECT user_id, family_id FROM memberships WHERE user_id = ANY($1::uuid[])', [userIds]) : { rows: [] }
  const isMember = (userId, familyId) => members.some((m) => m.user_id === userId && m.family_id === familyId)

  // Jetons supprimés pendant ce tour : leurs autres lignes sont abandonnées sans envoi.
  const deadTokens = new Set()
  let configAlarm = false
  const finish = async (row, status, error = null) => {
    await db.query(
      `UPDATE push_outbox SET status = $2, last_error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() END
        WHERE id = $1 AND status = 'pending'`, [row.id, status, error])
    summary[status === 'sent' ? 'sent' : 'failed']++
  }

  async function one(row) {
    const t = tokenById.get(row.token_id)
    // Jeton supprimé avant la réservation (token_id NULL), entre-temps ou plus tôt dans ce
    // tour : abandon, rien ne part.
    if (!t || deadTokens.has(t.id)) return finish(row, 'failed', 'token_gone')
    // Réveil `locate` resté en file au-delà de la consultation (worker en retard, Retry-After
    // long) : il ne réveillerait le téléphone pour rien.
    if (row.late) return finish(row, 'failed', 'expired')
    let name = null
    if (row.event === 'message' || CHILD_EVENTS.has(row.event) || SOS_EVENTS.has(row.event)) {
      const m = row.event === 'message' ? messageById.get(row.ref) : SOS_EVENTS.has(row.event) ? sosById.get(row.ref) : childById.get(row.ref)
      if (!m) return finish(row, 'failed', 'ref_missing')
      // Le destinataire doit être encore membre de la famille du message (départ entre-temps).
      if (t.session_id ? !isMember(t.user_id, m.family_id) : t.family_id !== m.family_id) return finish(row, 'failed', 'not_member')
      name = openField(m.first_name_enc, config.dataKey, childAad(m.child_id))
    }
    const message = buildPayload({ event: row.event, ref: row.ref, lang: t.lang, name })
    let result
    try { result = await provider.send(openField(t.token_enc, config.dataKey, tokenAad(t.id)), message) } catch { result = { ok: false, outcome: 'retry', error: 'provider exception' } }
    if (result.ok) return finish(row, 'sent')
    if (result.outcome === 'unregistered' || result.outcome === 'invalid_token') {
      // Jeton mort : supprimé (sa file n'est plus envoyée), compté une fois ; la ligne est abandonnée.
      if (!deadTokens.has(t.id)) {
        deadTokens.add(t.id)
        await db.query('DELETE FROM push_tokens WHERE id = $1', [t.id])
        summary.removedTokens++
        log.info({ push: row.id, error: result.error }, 'jeton push supprimé')
      }
      return finish(row, 'failed', result.error)
    }
    if (result.config && !configAlarm) {
      // Configuration FCM (projet, compte de service) : une alarme par tour, sans jeton.
      configAlarm = true
      log.error({ push: row.id, error: result.error }, 'push : configuration FCM refusée (projet Firebase ou compte de service)')
    }
    // `locate` : retenté seulement pendant la consultation (2 minutes, routes/location.js ;
    // `late` calculé par la base à la réservation) : un réveil tardif ne sert à rien.
    if (result.outcome === 'retry' && row.attempts < MAX_ATTEMPTS) {
      await db.query(
        `UPDATE push_outbox SET last_error = $2, next_attempt_at = now() + make_interval(secs => $3)
          WHERE id = $1 AND status = 'pending'`, [row.id, result.error, retryDelay(row.attempts, result.retryAfterS)])
      summary.retried++
      return
    }
    return finish(row, 'failed', result.error)
  }

  const queue = [...claimed]
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      try { await one(row) } catch (e) {
        // Erreur de notre côté (déchiffrement, charge utile) : abandon, sans réessai en boucle.
        log.error({ push: row.id, err: e.message }, 'notification push en échec')
        await finish(row, 'failed', 'internal').catch(() => {})
      }
    }
  }))
  return summary
}
