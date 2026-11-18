import Fastify from 'fastify'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, extname, relative } from 'node:path'
import { HttpError, SESSION_RULE } from './lib.js'
import { tokenHash, createLimiter, rateLimitKey } from './security.js'
import { readAuthCookie } from './auth-cookies.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import familiesRoutes from './routes/families.js'
import invitationsRoutes from './routes/invitations.js'
import childrenRoutes from './routes/children.js'
import contactsRoutes from './routes/contacts.js'
import { devicesRoutes, deviceSessionRoutes } from './routes/devices.js'

// Politique de contenu : tout vient de la même origine, aucun script en ligne,
// aucun tiers (polices hébergées sur place).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
]

const securityHeaders = (production) => ({
  // En production, tout sous-chargement http est forcé en https.
  'content-security-policy': [...CSP, ...(production ? ['upgrade-insecure-requests'] : [])].join('; '),
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // Ouvrir ici, une à une, les permissions dont l'app a besoin (geolocation=(self)…).
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin'
})

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
}

// Le front compilé est chargé en mémoire au démarrage : servi par une table
// fermée, aucun chemin fourni par le visiteur n'atteint le disque.
async function loadStatic(dir) {
  const files = new Map()
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) await walk(p)
      else if (TYPES[extname(e.name)]) files.set('/' + relative(dir, p).split('\\').join('/'), await readFile(p))
    }
  }
  try { await stat(dir); await walk(dir) } catch { /* API seule (tests) */ }
  return files
}

// En-tête que seul notre JavaScript envoie : un formulaire d'un autre site ne
// peut pas l'ajouter, et un fetch d'un autre site qui l'ajoute déclenche un
// pré-vol que l'API refuse.
export const CSRF_HEADER = 'x-app'

// Requêtes de l'application native : jeton Bearer, jamais de cookie.
const NATIVE_PATH = /^\/api\/auth\/native\//
// Téléphone de l'enfant (NAR-138) : ses seules routes, avec sa propre session.
const DEVICE_PATH = /^\/api\/device(?:[/?]|$)/
const BEARER = /^Bearer /
const bearerOf = (req) => {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')
  return m ? m[1] : null
}

export async function buildApp({ config, db, mailer, logger = true, dbReady = true }) {
  const app = Fastify({
    logger: logger && { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] },
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    requestTimeout: 30000,
    connectionTimeout: 65000,
    maxRequestsPerSocket: 1000,
    // Un champ inconnu est refusé (400), jamais retiré en silence : c'est la
    // parade à l'affectation de masse (s'attribuer is_admin en l'ajoutant au corps).
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }
  })
  app.decorate('config', config)
  app.decorate('db', db)
  // Vrai une fois les migrations appliquées (ou vérifiées). Avant, l'API répond
  // 503 ; /health répond toujours (il ne doit jamais dépendre de la base).
  app.decorate('dbReady', dbReady)
  app.decorate('mailer', mailer)

  // Par IP et par minute. Derrière le NAT d'un opérateur mobile, beaucoup
  // d'utilisateurs partagent une adresse : à relever (API_RATE_LIMIT) si l'app
  // native a du monde (HANDOFF.md, limites résiduelles).
  const apiLimit = createLimiter({ max: config.limits.apiPerMinute, windowMs: 60000 })
  // Deux calculs de mot de passe simultanés au plus par source : chacun réserve
  // ~128 Mo (scrypt). Libérés à la réponse, au délai dépassé ou à l'abandon.
  const hashes = new Map(), hashingRequests = new Map()
  const HASHING = /^\/api\/auth\/(?:login|register|reset-password|native\/login)(?:\?|$)/
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]
    let decoded
    try { decoded = decodeURIComponent(path) } catch { throw new HttpError(400, 'Adresse invalide.') }
    // Un chemin d'API encodé (/%61pi/…) contournerait les contrôles qui regardent le préfixe.
    if (decoded !== path && /^\/+api(?:[/%]|$)/i.test(decoded)) throw new HttpError(400, 'Adresse API non canonique.')
    // Les pré-vols CORS ne comptent pas : ils ne touchent ni la base ni un calcul.
    if (req.url.startsWith('/api/') && req.method !== 'OPTIONS' && !apiLimit(rateLimitKey(req.ip))) {
      reply.header('retry-after', '60')
      throw new HttpError(429, 'Trop de requêtes. Réessayez dans une minute.')
    }
    if (req.method === 'POST' && HASHING.test(req.url)) {
      const source = rateLimitKey(req.ip)
      if ((hashes.get(source) || 0) >= 2) throw new HttpError(429, 'Trop de requêtes simultanées. Réessayez.')
      hashes.set(source, (hashes.get(source) || 0) + 1)
      hashingRequests.set(req.id, source)
    }
  })
  const release = async req => {
    const ip = hashingRequests.get(req.id)
    if (ip) {
      const n = hashes.get(ip) - 1
      if (n) hashes.set(ip, n); else hashes.delete(ip)
      hashingRequests.delete(req.id)
    }
  }
  app.addHook('onResponse', release)
  app.addHook('onRequestAbort', release)
  app.addHook('onTimeout', release)

  const origins = new Set([config.origin, ...config.extraOrigins])
  const natives = new Set(config.nativeOrigins)

  const SECURITY_HEADERS = securityHeaders(config.production)
  app.addHook('onSend', async (req, reply, payload) => {
    reply.headers(SECURITY_HEADERS)
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store')
      // CORS de l'application native : origines exactes, jamais de cookie.
      // La valeur écrite vient de la liste de configuration, jamais de la requête.
      const allowed = config.nativeOrigins.find((o) => o === req.headers.origin)
      if (allowed) reply.header('access-control-allow-origin', allowed).header('vary', 'Origin').header('access-control-expose-headers', 'etag')
    }
    return payload
  })

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return
    const origin = req.headers.origin
    // Pré-vol de l'application native. Sans « allow-credentials » : aucun cookie ne traverse.
    if (req.method === 'OPTIONS') {
      const allowed = config.nativeOrigins.find((o) => o === origin)
      if (!allowed) throw new HttpError(403, 'Origine refusée.')
      return reply.code(204).headers({
        'access-control-allow-origin': allowed,
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
        // if-none-match : relevé conditionnel de la configuration d'appareil (304).
        'access-control-allow-headers': 'authorization, content-type, if-none-match',
        'access-control-max-age': '600',
        vary: 'Origin'
      }).send()
    }
    if (!app.dbReady) throw new HttpError(503, 'Service en cours de démarrage. Réessayez dans un instant.')
    if ((NATIVE_PATH.test(req.url) || DEVICE_PATH.test(req.url)) && !natives.has(origin)) throw new HttpError(403, 'Origine refusée.')
    // Le transport se décide UNE fois, ici, et le hook de session le relit :
    // application native (origine exacte de la WebView, qu'une page web ne peut
    // pas usurper) ou en-tête Authorization (qui ne part jamais tout seul depuis
    // un autre site) → le cookie n'est jamais lu, le contrôle CSRF ne s'applique pas.
    // Tout le reste → cookie, et contrôle CSRF sur les écritures.
    // Seul un en-tête « Bearer » compte : un « Basic » ajouté par un mandataire
    // (préprod protégée par mot de passe) ne doit pas faire perdre la session web.
    req.authTransport = natives.has(origin) || BEARER.test(req.headers.authorization || '') ? 'bearer' : 'cookie'
    if (req.authTransport === 'bearer') return
    if (['GET', 'HEAD'].includes(req.method)) return
    // Anti-CSRF, en plus du cookie SameSite=Strict : toute écriture exige la
    // bonne origine ET l'en-tête que seul notre JavaScript envoie.
    // Hors production seulement : tout port de localhost (serveur Vite du développeur).
    const devLocal = !config.production && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '')
    if (!origin || !(origins.has(origin) || devLocal)) throw new HttpError(403, 'Origine refusée.')
    if (req.headers[CSRF_HEADER] !== '1') throw new HttpError(403, 'Requête refusée.')
  })

  // Session : jeton opaque ; la base ne connaît que son empreinte. Web : cookie
  // HttpOnly, expiration glissante plafonnée. Natif : en-tête Bearer, jeton
  // d'accès court renouvelé par /api/auth/native/refresh. Un transport ne
  // remplace jamais l'autre : un jeton présenté par le mauvais canal est refusé.
  app.decorateRequest('user', null)
  app.decorateRequest('sessionHash', null)
  // 'cookie' tant que onRequest n'a pas tranché : c'est le cas qui exige le contrôle CSRF.
  app.decorateRequest('authTransport', 'cookie')
  app.decorateRequest('device', null)
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return
    // Session d'appareil : cherchée parmi les seules sessions d'appareil, jamais par
    // cookie ni parmi les sessions de compte. Un appareil révoqué n'en a plus.
    // Réciproquement, plus bas, une session de compte n'atteint jamais ces routes.
    if (DEVICE_PATH.test(req.url)) {
      const token = bearerOf(req)
      if (token) {
        // Une seule requête : session valable d'un appareil non révoqué, et « vu à »
        // de l'appareil rafraîchi au plus une fois par minute.
        const { rows } = await db.query(
          `WITH s AS (
             SELECT d.id, d.family_id, d.child_id FROM device_sessions s JOIN child_devices d ON d.id = s.device_id
              WHERE s.token_hash = $1 AND s.expires_at > now() AND d.revoked_at IS NULL
              -- Verrou partagé : une révocation en cours (UPDATE de l'appareil, DELETE
              -- des sessions) est attendue, puis la ligne relue : jamais servie après.
              FOR SHARE OF s, d
           ), seen AS (
             UPDATE child_devices c SET last_seen_at = now() FROM s
              WHERE c.id = s.id AND c.last_seen_at < now() - interval '1 minute'
           )
           SELECT id, family_id, child_id FROM s`, [tokenHash(token)])
        if (rows[0]) req.device = { id: rows[0].id, familyId: rows[0].family_id, childId: rows[0].child_id }
      }
      const route = req.routeOptions
      if (route.url && !route.config?.public && !req.device) throw new HttpError(401, 'Session de l’appareil expirée.')
      return
    }
    const kind = req.authTransport
    const token = kind === 'bearer' ? bearerOf(req) : readAuthCookie(req, config, 'session')
    if (token) {
      const hash = tokenHash(token)
      // Une seule requête : prolonge, joint l'utilisateur (relu à chaque fois :
      // un changement de rôle s'applique tout de suite) et intègre la condition
      // MFA — une session d'admin sans second facteur vérifié n'est pas une session.
      const { rows } = await db.query(
        `UPDATE sessions s SET last_seen_at = now(),
                expires_at = CASE WHEN s.kind = 'cookie'
                  THEN LEAST(now() + make_interval(days => $2), s.created_at + make_interval(days => $3))
                  ELSE s.expires_at END
          FROM users u
         WHERE s.token_hash = $1 AND s.kind = $4 AND s.expires_at > now() AND u.id = s.user_id
           AND ${SESSION_RULE}
         RETURNING u.id, u.email, u.name, u.is_admin`,
        [hash, config.session.idleDays, config.session.absoluteDays, kind])
      if (rows[0]) { req.user = rows[0]; req.sessionHash = hash }
    }
    // Fermé par défaut : une route d'API exige une session, sauf si elle est
    // déclarée `config: { public: true }`. Une route oubliée est fermée, pas ouverte.
    const route = req.routeOptions
    if (route.url && !route.config?.public && !req.user) throw new HttpError(401, 'Connexion requise.')
    // Une route d'appareil hors de /api/device/ serait une erreur de montage : fermée.
    if (route.config?.device) throw new HttpError(401, 'Connexion requise.')
    if (route.config?.admin && !req.user?.is_admin) throw new HttpError(403, 'Action réservée à l’équipe.')
  })

  app.decorate('requireUser', (req) => {
    if (!req.user) throw new HttpError(401, 'Connexion requise.')
    return req.user
  })
  app.decorate('requireAdmin', (req) => {
    if (!req.user) throw new HttpError(401, 'Connexion requise.')
    if (!req.user.is_admin) throw new HttpError(403, 'Action réservée à l’équipe.')
    return req.user
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.retryAfter) reply.header('retry-after', String(err.retryAfter))
      return reply.code(err.status).send({ error: err.message, ...(err.code ? { code: err.code } : {}) })
    }
    if (err.validation) return reply.code(400).send({ error: 'Requête invalide.' })
    if (err.statusCode === 413) return reply.code(413).send({ error: 'Requête trop volumineuse.' })
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'Requête invalide.' })
    // Le détail (SQL, chemins, pile) va dans le journal, jamais dans la réponse.
    req.log.error(err)
    return reply.code(500).send({ error: 'Erreur interne. Réessayez dans un instant.' })
  })

  // Santé (contrat NosyHost) : ne dépend PAS de la base, sinon une coupure de
  // la base déclencherait un retour arrière inutile. /ready la vérifie.
  app.get('/health', async () => ({ ok: true }))
  app.get('/ready', async (req, reply) => {
    if (!app.dbReady) return reply.code(503).send({ ok: false })
    try { await db.query('SELECT 1'); return { ok: true } } catch { return reply.code(503).send({ ok: false }) }
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(adminRoutes, { prefix: '/api/admin' })
  await app.register(familiesRoutes, { prefix: '/api/families' })
  await app.register(invitationsRoutes, { prefix: '/api/invitations' })
  await app.register(childrenRoutes, { prefix: '/api/children' })
  await app.register(contactsRoutes, { prefix: '/api' })
  await app.register(devicesRoutes, { prefix: '/api' })
  await app.register(deviceSessionRoutes, { prefix: '/api/device' })

  // APK de l'app enfant (NAR-165) : lu une fois au démarrage, servi tel quel, sans
  // session (Android le télécharge pendant le provisionnement par QR). L'intégrité
  // est garantie par la somme du certificat de signature portée par le QR.
  const childApk = await readFile(join(config.downloadsDir, 'akaiky-enfant.apk')).catch(() => null)
  const sendApk = async (req, reply) => {
    if (!childApk) return reply.code(404).type('text/plain; charset=utf-8').send('Introuvable')
    return reply
      .type('application/vnd.android.package-archive')
      .header('content-disposition', 'attachment; filename="akaiky-enfant.apk"')
      .header('cache-control', 'no-cache')
      .send(childApk)
  }
  app.get('/downloads/akaiky-enfant.apk', sendApk)

  const files = await loadStatic(config.staticDir)
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) {
      return reply.code(404).send({ error: 'Introuvable.' })
    }
    let path
    try { path = decodeURIComponent(req.url.split('?')[0]) } catch { return reply.code(400).send({ error: 'Adresse invalide.' }) }
    let body = files.get(path)
    let file = path
    if (!body) {
      // Route de l'application (SPA) : index.html. Un fichier manquant garde son 404.
      if (extname(path)) return reply.code(404).type('text/plain; charset=utf-8').send('Introuvable')
      body = files.get('/index.html'); file = '/index.html'
      if (!body) return reply.code(404).send('Introuvable')
    }
    return reply
      .type(TYPES[extname(file)])
      .header('cache-control', file.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(body)
  })

  return app
}
