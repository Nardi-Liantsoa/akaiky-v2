// Configuration par variables d'environnement (contrat NosyHost). Toute valeur
// manquante ou invalide arrête le démarrage : mieux vaut un conteneur qui ne
// démarre pas qu'une API qui tourne avec une sécurité dégradée.

// Entier strictement positif, ou la valeur par défaut si la variable est absente.
// « 15m », « » ou « abc » arrêtent le démarrage au lieu de donner NaN.
function positive(value, fallback) {
  const n = value === undefined ? fallback : Number(value)
  if (value === '' || !Number.isSafeInteger(n) || n < 1) throw new Error(`Valeur numérique invalide : « ${value} »`)
  return n
}

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`)
  return v
}

function trustedProxies(value) {
  if (!value || value === 'false') return false
  const proxies = value.split(',').map(s => s.trim())
  // Adresses ou CIDR explicites seulement : jamais « tout le monde » ni un nombre de sauts.
  if (proxies.some(p => !/[.:]/.test(p) || !/^[0-9a-fA-F:.]+(?:\/\d{1,3})?$/.test(p))) throw new Error('TRUST_PROXY exige des adresses IP ou CIDR explicites')
  return proxies
}

// Origines des WebView Capacitor autorisées à parler à l'API par jeton Bearer :
// https://localhost (Android, androidScheme https) et capacitor://localhost (iOS).
// Vide : le transport Bearer est fermé, seul le cookie de la version web existe.
function nativeOrigins(value) {
  const list = (value || '').split(',').map(s => s.trim()).filter(Boolean)
  if (list.some(o => !/^(https|capacitor):\/\/[a-z0-9.-]+(:\d+)?$/i.test(o))) throw new Error('NATIVE_ORIGINS : origines https:// ou capacitor:// exactes, séparées par des virgules')
  return list
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const origin = (env.APP_ORIGIN || (production ? '' : 'http://localhost:8080')).replace(/\/$/, '')
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) throw new Error('APP_ORIGIN invalide (ex. https://akaiky.a-definir.invalid)')
  if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN doit être en https en production')

  if (env.DB_MIGRATIONS && !['auto', 'verify'].includes(env.DB_MIGRATIONS)) throw new Error('DB_MIGRATIONS invalide')
  const mfaKey = env.MFA_ENCRYPTION_KEY || (production ? '' : 'ab'.repeat(32))
  if (!/^[a-f0-9]{64}$/i.test(mfaKey)) throw new Error('MFA_ENCRYPTION_KEY : clé hexadécimale de 32 octets requise (openssl rand -hex 32)')
  // Sans mandataire de confiance, toutes les requêtes semblent venir de Traefik :
  // chaque limite par IP deviendrait une limite pour tout le site.
  if (production && !trustedProxies(env.TRUST_PROXY)) throw new Error('TRUST_PROXY requis en production (CIDR du réseau edge du client)')
  if (production && env.SMTP_HOST && !env.MAIL_FROM) throw new Error('MAIL_FROM requis en production (adresse d’un domaine authentifié SPF/DKIM/DMARC)')
  // Recette automatique (skill ampy-recette) : emails écrits dans un fichier au lieu d'être envoyés.
  if (production && env.MAIL_OUTBOX) throw new Error('MAIL_OUTBOX est réservé aux tests : interdit en production')
  return {
    appName: env.APP_NAME || 'Akaiky',
    mfaKey,
    production,
    migrations: env.DB_MIGRATIONS || 'auto',
    port: positive(env.PORT, 8080),
    databaseUrl: env.DATABASE_URL || required('DATABASE_URL'),
    origin,
    // Seconde origine acceptée pour les requêtes (ex. domaine temporaire de la prod).
    extraOrigins: (env.APP_EXTRA_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    nativeOrigins: nativeOrigins(env.NATIVE_ORIGINS),
    staticDir: env.STATIC_DIR || new URL('../../dist/web', import.meta.url).pathname,
    // Traefik est le seul mandataire devant l'application.
    trustProxy: trustedProxies(env.TRUST_PROXY),
    session: {
      idleDays: positive(env.SESSION_IDLE_DAYS, 14),
      absoluteDays: positive(env.SESSION_ABSOLUTE_DAYS, 30)
    },
    // Application native : jeton d'accès court, jeton de renouvellement tourné à chaque usage.
    native: {
      accessMinutes: positive(env.NATIVE_ACCESS_MINUTES, 15),
      refreshDays: positive(env.NATIVE_REFRESH_DAYS, 30)
    },
    mail: {
      host: env.SMTP_HOST || '',
      port: positive(env.SMTP_PORT, 465),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || 'Akaiky <no-reply@akaiky.a-definir.invalid>',
      replyTo: env.MAIL_REPLY_TO || undefined,
      outbox: env.MAIL_OUTBOX || ''
    },
    quotas: {
      registrationsPerHour: positive(env.REGISTRATIONS_PER_HOUR, 100),
      authEmailsPerHour: positive(env.AUTH_EMAILS_PER_HOUR, 200),
      notesPerUser: positive(env.NOTES_PER_USER, 1000)
    },
    // Anti brute force : tentatives par IP (15 min) et par adresse email (1 h).
    limits: { perIp: positive(env.RATE_LIMIT_IP, 20), perEmail: positive(env.RATE_LIMIT_EMAIL, 5), apiPerMinute: positive(env.API_RATE_LIMIT, 300) }
  }
}
