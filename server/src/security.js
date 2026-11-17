import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, createHmac } from 'node:crypto'
import { HttpError } from './lib.js'
import { promisify } from 'node:util'

const scryptRaw = promisify(scryptCb)

// Chaque calcul réserve ~128 Mo : deux au plus en parallèle, les autres
// attendent. Sans cette file, dix connexions simultanées dépasseraient la
// mémoire du conteneur (512 Mo) — un déni de service à la portée de tous.
let running = 0
const waiting = []
async function scrypt(...args) {
  // La place est transmise directement au suivant : aucun troisième calcul ne
  // peut se glisser entre la libération et la reprise.
  if (running >= 2) {
    if (waiting.length >= 8) throw new HttpError(503, 'Service occupé. Réessayez dans quelques instants.')
    await new Promise((resolve) => waiting.push(resolve))
  }
  else running += 1
  try { return await scryptRaw(...args) } finally {
    const next = waiting.shift()
    if (next) next()
    else running -= 1
  }
}

// scrypt (RFC 7914), paramètres OWASP : N=2^17, r=8, p=1 — environ 128 Mo et
// ~150 ms par hachage. Le format embarque les paramètres pour pouvoir les
// relever plus tard sans invalider les mots de passe existants.
const N = 2 ** 17, R = 8, P = 1, KEYLEN = 64
const MAXMEM = 256 * 1024 * 1024

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$')
  if (alg !== 'scrypt') return false
  const expected = Buffer.from(keyB64, 'base64')
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// Empreinte factice : une connexion sur un email inconnu coûte le même temps
// qu'une vraie vérification — le délai de réponse ne révèle pas les comptes.
let dummyHash
export async function burnPasswordTime(password) {
  dummyHash ||= hashPassword('mot-de-passe-factice-pour-egaliser-le-temps').catch(e => { dummyHash = undefined; throw e })
  await verifyPassword(password, await dummyHash)
}

// Jeton opaque de 256 bits ; seule son empreinte SHA-256 est stockée en base.
export function newToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: tokenHash(token) }
}
export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest()
}

// Politique de mot de passe : longueur plutôt que complexité (NIST SP 800-63B),
// avec refus des mots de passe triviaux ou reprenant l'email.
const TRIVIAL = /^(.)\1+$|^(0123456789|1234567890|azertyuiop|qwertyuiop|motdepasse|password)/i
export function passwordProblem(password, email = '') {
  if (typeof password !== 'string') return 'Mot de passe requis.'
  if (password.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.'
  if (password.length > 200) return 'Le mot de passe est trop long.'
  if (TRIVIAL.test(password)) return 'Ce mot de passe est trop facile à deviner.'
  const local = email.split('@')[0]
  if (local.length >= 4 && password.toLowerCase().includes(local.toLowerCase())) {
    return 'Le mot de passe ne doit pas contenir votre adresse email.'
  }
  return null
}

// Limiteur en mémoire (une seule instance par environnement) : fenêtre glissante
// simple par clé. Suffisant derrière Traefik pour freiner le brute force.
export function createLimiter({ max, windowMs, maxKeys = 10000 }) {
  const hits = new Map()
  // À saturation, des compartiments indépendants remplacent le refus global.
  // Une collision partage un quota, sans jamais évincer une IP déjà bloquée.
  const overflow = new Array(4096), salt = randomBytes(32)
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
  }, windowMs).unref()
  return (key) => {
    const now = Date.now()
    let h = hits.get(key)
    if (!h || h.reset < now) {
      if (!h && hits.size >= maxKeys) {
        const index = createHmac('sha256', salt).update(key).digest().readUInt32BE(0) % overflow.length
        let bucket = overflow[index]
        if (!bucket || bucket.reset < now) overflow[index] = bucket = { count: 0, reset: now + windowMs }
        return ++bucket.count <= max
      }
      h = { count: 0, reset: now + windowMs }; hits.set(key, h)
    }
    h.count += 1
    return h.count <= max
  }
}

// Même quota pour les adresses temporaires d’un préfixe IPv6 /64.
export function rateLimitKey(ip) {
  if (!ip.includes(':')) return ip
  if (ip.startsWith('::ffff:') && ip.includes('.')) return ip.slice(7)
  const [left, right = ''] = ip.split('::')
  const a = left ? left.split(':') : [], b = right ? right.split(':') : []
  const parts = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a
  return parts.slice(0, 4).map(x => parseInt(x, 16).toString(16)).join(':') + '::/64'
}
