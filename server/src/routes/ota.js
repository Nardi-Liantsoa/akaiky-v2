// Serveur OTA auto-hébergé (NAR-189), au format du greffon @capgo/capacitor-updater 8.54
// (« updateUrl » et « channelUrl » auto-hébergés). Préfixe /api/ota, routes publiques : le
// greffon appelle depuis le natif (OkHttp, URLSession), sans session, sans cookie ni origine.
// Rien n'est écrit : aucune donnée de l'appareil n'est gardée ni journalisée.
//
//   POST /latest        corps d'information du greffon → { version, url, checksum, target, data }
//                       (data : la cible en chaînes, seule forme que le greffon iOS transmet)
//                       ou { error: 'no_new_version_available', message } ;
//   PUT  /channel       getChannel() du greffon → { channel, status, allowSet: false } :
//                       toujours un canal de l'app qui demande (le greffon le garde comme
//                       canal par défaut) ;
//   GET  /bundles/:id   le zip, cherché en base par identifiant (table fermée, aucun chemin
//                       vers le disque).
//
// setChannel / unsetChannel / listChannels ne sont pas servis (404) : les coques les
// désactivent (allowSetDefaultChannel: false) et rien ne doit pouvoir changer de canal.
import { HttpError } from '../lib.js'
import { createLimiter, rateLimitKey } from '../security.js'
import { kindFromAppId, otaVerdict, ownAppId, readRequest, targetData } from '../ota.js'

// Champs que le greffon 8.54.2 envoie (Android createInfoObject, iOS InfoObject). Un champ
// inconnu est un 400 (aucune mise à jour), pas un champ retiré en silence : la route ne garde
// rien, mais une coque qui enverrait autre chose n'a pas été vérifiée contre ce serveur. Une
// nouvelle version du greffon est une nouvelle coque : la liste se met à jour avant elle.
const s = (maxLength) => ({ type: 'string', maxLength })
const INFO = {
  type: 'object',
  additionalProperties: false,
  required: ['platform', 'app_id', 'version_code', 'defaultChannel'],
  properties: {
    platform: { type: 'string', enum: ['android', 'ios'] },
    device_id: s(128),
    app_id: { type: 'string', minLength: 1, maxLength: 200 },
    custom_id: s(200),
    version_build: s(64),
    version_code: s(20),
    version_os: s(64),
    version_name: s(128),
    old_version_name: s(128),
    plugin_version: s(32),
    is_emulator: { type: 'boolean' },
    is_prod: { type: 'boolean' },
    install_source: s(128),
    action: s(64),
    channel: s(64),
    defaultChannel: s(64),
    key_id: s(128)
  }
}
const BUNDLE_ID = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' } } }

const REFUSALS = {
  unknown_shell: 'Application ou version de coque inconnue.',
  wrong_channel: 'Canal étranger à cette application.'
}
const noUpdate = { error: 'no_new_version_available', message: 'Aucune mise à jour pour cette application.' }

export default async function otaRoutes(app) {
  const { db, config } = app
  // Vérifications : une par lancement d'app ; le greffon se met en pause sur un 429.
  const checkLimit = createLimiter({ max: config.limits.otaPerMinute, windowMs: 60000 })
  // Téléchargements complets (quelques Mo chacun) par IP et par 15 minutes.
  const downloadLimit = createLimiter({ max: config.limits.otaDownloadsPer15Min, windowMs: 15 * 60000 })
  const limited = (limit, req, seconds) => {
    if (limit(rateLimitKey(req.ip))) return
    const err = new HttpError(429, 'Trop de requêtes. Réessayez plus tard.', 'too_many_requests')
    err.retryAfter = seconds
    throw err
  }

  const opts = (schema) => ({ config: { public: true, ota: true }, bodyLimit: 8 * 1024, schema: { body: schema } })

  app.post('/latest', opts(INFO), async (req, reply) => {
    limited(checkLimit, req, 60)
    const ask = readRequest(req.body)
    if (ask.refused) throw new HttpError(400, REFUSALS[ask.refused], ask.refused)
    // Le plus récent des bundles de CETTE app, sur CE canal, qu'une coque de ce versionCode
    // peut faire tourner (un bundle plus récent mais trop exigeant laisse passer le précédent).
    const { rows: [row] } = await db.query(
      `SELECT id, app, channel, version, min_native_build, sha256 FROM ota_bundles
        WHERE app = $1 AND channel = $2 AND min_native_build <= $3
        ORDER BY created_at DESC, id DESC LIMIT 1`, [ask.kind, ask.channel, ask.build])
    if (!row) return reply.send(noUpdate)
    const target = { app: row.app, channel: row.channel, minNativeBuild: row.min_native_build }
    // Défense en profondeur : la ligne repasse par la règle de l'écran avant de partir.
    if (otaVerdict(target, ask.shell) !== 'accept') {
      req.log.error({ bundle: row.id }, 'Bundle OTA refusé par la règle des cibles')
      return reply.send(noUpdate)
    }
    if (req.body.version_name === row.version) return reply.send(noUpdate)
    return reply.send({ version: row.version, url: `${config.origin}/api/ota/bundles/${row.id}`, checksum: row.sha256, target, data: targetData(target) })
  })

  app.put('/channel', opts(INFO), async (req, reply) => {
    limited(checkLimit, req, 60)
    const { app_id: appId, defaultChannel } = req.body
    if (!ownAppId(appId)) throw new HttpError(400, REFUSALS.unknown_shell, 'unknown_shell')
    // Le canal demandé s'il est à cette app (canal de test d'une coque de test), sinon le canal
    // de l'app elle-même : la réponse est tirée de app_id, jamais d'une autre app.
    const kind = kindFromAppId(appId)
    const ask = readRequest({ app_id: appId, version_code: '1', defaultChannel })
    const channel = ask.refused ? kind : ask.channel
    return reply.send({ channel, status: 'default', allowSet: false })
  })

  // Bundles immuables (aucun UPDATE possible, même par la publication) : gardés en mémoire
  // après la première lecture, quatre au plus, et une seule lecture en base par bundle à la fois.
  // Quatre lectures de bundles différents au plus en même temps (10 Mo chacun, plus le texte
  // hexadécimal que pg décode) : au-delà, 503, pour que d'anciens identifiants ne gonflent pas la mémoire.
  const cache = new Map(), pending = new Map()
  const load = async (id) => {
    if (cache.has(id)) { const hit = cache.get(id); cache.delete(id); cache.set(id, hit); return hit }
    if (!pending.has(id)) {
      if (pending.size >= 4) {
        const err = new HttpError(503, 'Service occupé. Réessayez dans un instant.')
        err.retryAfter = 30
        throw err
      }
      pending.set(id, db.query('SELECT bundle, sha256 FROM ota_bundles WHERE id = $1', [id]).then(({ rows: [r] }) => {
        if (!r) return null
        const hit = { body: r.bundle, etag: `"${r.sha256}"` }
        cache.set(id, hit)
        while (cache.size > 4) cache.delete(cache.keys().next().value)
        return hit
      }).finally(() => pending.delete(id)))
    }
    return pending.get(id)
  }

  app.get('/bundles/:id', { config: { public: true, ota: true }, schema: { params: BUNDLE_ID } }, async (req, reply) => {
    // Limite comptée AVANT la lecture : une requête refusée ne coûte aucune lecture de 10 Mo
    // en base (HEAD et relevé conditionnel compris ; le greffon ne fait qu'un GET par bundle).
    limited(downloadLimit, req, 900)
    const hit = await load(req.params.id)
    if (!hit) throw new HttpError(404, 'Introuvable.')
    reply.header('etag', hit.etag)
    if (req.headers['if-none-match'] === hit.etag) return reply.code(304).send()
    return reply
      .type('application/zip')
      .header('content-disposition', 'attachment; filename="bundle.zip"')
      .send(hit.body)
  })
}
