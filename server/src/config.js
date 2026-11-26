import { loadServiceAccount } from './push.js'

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

// Limite par IP : entier positif plafonné, pour qu'une valeur géante ne revienne pas à la couper.
function capped(value, fallback, name) {
  const n = positive(value, fallback)
  if (n > 100000) throw new Error(`${name} : 100000 au plus`)
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

function phoneCountry(v) {
  const c = (v || 'MG').toUpperCase()
  if (!['MG', 'FR'].includes(c)) throw new Error('PHONE_DEFAULT_COUNTRY : MG ou FR')
  return c
}

// APK de l'app enfant, dont l'adresse et la somme du certificat de signature vont
// dans le QR d'appairage (NAR-138 ; fichier servi et signé par NAR-165). Absentes :
// pas de QR possible (la route d'appairage répond 503), sans empêcher le démarrage.
function deviceApk(env, production, natives) {
  const url = env.DEVICE_APK_URL || ''
  const checksum = env.DEVICE_APK_SIGNATURE_SHA256 || ''
  const versionRaw = env.DEVICE_APK_VERSION_CODE
  const shaRaw = env.DEVICE_APK_SHA256
  if (!url && !checksum) {
    if (versionRaw || shaRaw) throw new Error('DEVICE_APK_VERSION_CODE et DEVICE_APK_SHA256 exigent DEVICE_APK_URL')
    return null
  }
  if (!url || !checksum) throw new Error('DEVICE_APK_URL et DEVICE_APK_SIGNATURE_SHA256 vont ensemble')
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/[^\s?#]*\.apk$/i.test(url) && !(!production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url))) {
    throw new Error('DEVICE_APK_URL : adresse https d’un fichier .apk')
  }
  // SHA-256 du certificat de signature, en base64url sans remplissage (43 caractères),
  // le format qu'Android attend dans PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM.
  if (!/^[A-Za-z0-9_-]{43}$/.test(checksum)) throw new Error('DEVICE_APK_SIGNATURE_SHA256 : SHA-256 en base64url (43 caractères)')
  // Le téléphone appelle /api/device/* depuis la WebView Android (https://localhost) :
  // sans cette origine autorisée, un QR serait émis pour un échange toujours refusé.
  if (!natives.includes('https://localhost')) throw new Error('DEVICE_APK_URL exige NATIVE_ORIGINS avec https://localhost (WebView Android)')
  // Mise à jour de l'app enfant sur le téléphone verrouillé (NAR-170) : versionCode de l'APK
  // publié (enfant { } d'android/app/build.gradle), annoncé dans /api/device/config. Exigé en
  // production : sans lui, aucun téléphone ne saurait qu'une version plus récente existe.
  let versionCode = null
  if (versionRaw !== undefined && versionRaw !== '') {
    versionCode = Number(versionRaw)
    if (!/^\d+$/.test(versionRaw) || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
      throw new Error('DEVICE_APK_VERSION_CODE : entier strictement positif (versionCode de l’APK publié)')
    }
  } else if (production) {
    throw new Error('DEVICE_APK_VERSION_CODE requis en production avec DEVICE_APK_URL (versionCode de l’APK publié, NOSYHOST.md § 6)')
  }
  // SHA-256 du fichier APK (hexadécimal) quand il n'est pas servi par ce serveur ; sinon
  // calculé au démarrage sur le fichier embarqué (app.js).
  if (shaRaw && !/^[a-f0-9]{64}$/i.test(shaRaw)) throw new Error('DEVICE_APK_SHA256 : SHA-256 du fichier en hexadécimal (64 caractères)')
  return { url, signatureChecksum: checksum, versionCode, sha256: shaRaw ? shaRaw.toLowerCase() : null }
}

// Notifications push (NAR-141) : fcm (envoi réel), fake (mémoire, développement et tests),
// none (aucun envoi). Choix explicite exigé en production, où fake est refusé ; fcm exige
// un compte de service valable dès le démarrage.
function push(env, production) {
  const provider = env.PUSH_PROVIDER || (production ? '' : 'fake')
  if (!provider) throw new Error('PUSH_PROVIDER requis en production : fcm ou none')
  if (!['fcm', 'fake', 'none'].includes(provider)) throw new Error('PUSH_PROVIDER : fcm, fake ou none')
  if (production && provider === 'fake') throw new Error('PUSH_PROVIDER=fake est réservé aux tests : interdit en production')
  return { provider, serviceAccount: provider === 'fcm' ? loadServiceAccount(env.FCM_SERVICE_ACCOUNT) : null }
}

// SMS (NAR-136) : fake (développement et tests : mémoire, et fichier SMS_OUTBOX s'il est donné)
// ou none (aucun envoi : inscription et renvoi de code par téléphone répondent 503). Le
// fournisseur réel fera l'objet d'un ticket à part. fake et SMS_OUTBOX sont refusés en
// production : un code ne doit jamais atterrir ailleurs que sur le téléphone.
function sms(env, production) {
  const provider = env.SMS_PROVIDER || (production ? 'none' : 'fake')
  if (!['fake', 'none'].includes(provider)) throw new Error('SMS_PROVIDER : fake ou none (fournisseur réel : ticket à part)')
  if (production && provider === 'fake') throw new Error('SMS_PROVIDER=fake est réservé aux tests : interdit en production')
  if (production && env.SMS_OUTBOX) throw new Error('SMS_OUTBOX est réservé aux tests : interdit en production')
  if (env.SMS_OUTBOX && provider !== 'fake') throw new Error('SMS_OUTBOX exige SMS_PROVIDER=fake')
  return { provider, outbox: env.SMS_OUTBOX || '' }
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const natives = nativeOrigins(env.NATIVE_ORIGINS)
  const origin = (env.APP_ORIGIN || (production ? '' : 'http://localhost:8080')).replace(/\/$/, '')
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) throw new Error('APP_ORIGIN invalide (ex. https://akaiky.a-definir.invalid)')
  if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN doit être en https en production')

  if (env.DB_MIGRATIONS && !['auto', 'verify'].includes(env.DB_MIGRATIONS)) throw new Error('DB_MIGRATIONS invalide')
  const mfaKey = env.MFA_ENCRYPTION_KEY || (production ? '' : 'ab'.repeat(32))
  if (!/^[a-f0-9]{64}$/i.test(mfaKey)) throw new Error('MFA_ENCRYPTION_KEY : clé hexadécimale de 32 octets requise (openssl rand -hex 32)')
  // Données sensibles des familles (prénoms d'enfants…). Clé distincte de celle de la MFA :
  // la compromission ou la rotation de l'une ne touche pas l'autre.
  const dataKey = env.DATA_ENCRYPTION_KEY || (production ? '' : 'cd'.repeat(32))
  if (!/^[a-f0-9]{64}$/i.test(dataKey)) throw new Error('DATA_ENCRYPTION_KEY : clé hexadécimale de 32 octets requise (openssl rand -hex 32)')
  if (dataKey.toLowerCase() === mfaKey.toLowerCase()) throw new Error('DATA_ENCRYPTION_KEY doit différer de MFA_ENCRYPTION_KEY')
  // Sans mandataire de confiance, toutes les requêtes semblent venir de Traefik :
  // chaque limite par IP deviendrait une limite pour tout le site.
  if (production && !trustedProxies(env.TRUST_PROXY)) throw new Error('TRUST_PROXY requis en production (CIDR du réseau edge du client)')
  if (production && env.SMTP_HOST && !env.MAIL_FROM) throw new Error('MAIL_FROM requis en production (adresse d’un domaine authentifié SPF/DKIM/DMARC)')
  // Recette automatique (skill ampy-recette) : emails écrits dans un fichier au lieu d'être envoyés.
  if (production && env.MAIL_OUTBOX) throw new Error('MAIL_OUTBOX est réservé aux tests : interdit en production')
  const pushConfig = push(env, production)
  const smsConfig = sms(env, production)
  return {
    appName: env.APP_NAME || 'Akaiky',
    mfaKey,
    dataKey,
    // Pays des numéros locaux (commençant par 0) : MG ou FR, marché à trancher (CdC §12.1).
    phoneCountry: phoneCountry(env.PHONE_DEFAULT_COUNTRY),
    production,
    migrations: env.DB_MIGRATIONS || 'auto',
    port: positive(env.PORT, 8080),
    databaseUrl: env.DATABASE_URL || required('DATABASE_URL'),
    origin,
    // Seconde origine acceptée pour les requêtes (ex. domaine temporaire de la prod).
    extraOrigins: (env.APP_EXTRA_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    nativeOrigins: natives,
    deviceApk: deviceApk(env, production, natives),
    push: pushConfig,
    sms: smsConfig,
    staticDir: env.STATIC_DIR || new URL('../../dist/web', import.meta.url).pathname,
    // Fond de carte (NAR-205) : extrait PMTiles de Madagascar sur un volume (~300 Mo, hors image).
    // Absent : la carte est indisponible et l'app montre la position en texte.
    mapTilesFile: env.MAP_TILES_FILE || null,
    // APK de l'app enfant embarqué dans l'image (NAR-165), servi à /downloads/akaiky-enfant.apk.
    downloadsDir: env.DOWNLOADS_DIR || new URL('../../downloads', import.meta.url).pathname,
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
      // Budget séparé : des invitations en rafale n'épuisent pas celui des courriels de compte.
      invitationEmailsPerHour: positive(env.INVITATION_EMAILS_PER_HOUR, 100),
      // SMS d'authentification, tous numéros confondus (un SMS coûte : attaque de facturation).
      smsPerHour: positive(env.SMS_PER_HOUR, 100)
    },
    // Anti brute force : tentatives par IP (15 min) et par adresse email (1 h).
    limits: {
      perIp: positive(env.RATE_LIMIT_IP, 20), perEmail: positive(env.RATE_LIMIT_EMAIL, 5), apiPerMinute: positive(env.API_RATE_LIMIT, 300),
      // Serveur OTA (NAR-189), par IP : vérifications par minute, téléchargements complets par
      // 15 minutes. À relever derrière un NAT d'opérateur, sans jamais couper la limite.
      otaPerMinute: capped(env.OTA_RATE_LIMIT, 60, 'OTA_RATE_LIMIT'),
      otaDownloadsPer15Min: capped(env.OTA_DOWNLOAD_RATE_LIMIT, 30, 'OTA_DOWNLOAD_RATE_LIMIT'),
      // SMS (NAR-136) : par numéro et par heure (en base), délai minimal entre deux envois au
      // même numéro (en base), par IP (/64) et par heure (en mémoire, une instance).
      smsPerNumber: capped(env.SMS_PER_NUMBER_PER_HOUR, 3, 'SMS_PER_NUMBER_PER_HOUR'),
      smsCooldownSeconds: capped(env.SMS_RESEND_SECONDS, 60, 'SMS_RESEND_SECONDS'),
      smsPerIp: capped(env.SMS_PER_IP_PER_HOUR, 10, 'SMS_PER_IP_PER_HOUR')
    }
  }
}
