// Inscription par numéro de téléphone (NAR-136, CdC §5.1) : numéro + mot de passe, numéro
// confirmé par un code SMS de 6 chiffres (comme l'adresse par un lien). La connexion par
// numéro + mot de passe passe par /login et /native/login (checkCredentials, auth.js).
//
// Règles (ampy-auth, « Connexion par téléphone ») :
//   - code `crypto.randomInt`, stocké en HMAC-SHA256 (clé dérivée de DATA_ENCRYPTION_KEY :
//     un million de codes se testeraient en un instant contre un simple SHA-256), 5 minutes,
//     5 essais, puis supprimé ; un seul valable par numéro et par usage ;
//   - envois limités par IP (/64, mémoire), par numéro (en base : nombre par heure et délai
//     minimal entre deux envois) et au total (security_quotas « sms ») ; comptés que le numéro
//     ait un compte ou non ;
//   - réponse et durée identiques que le numéro ait un compte ou non : lecture du compte et
//     envoi dans la file asynchrone, réponse après une durée plancher ;
//   - jamais le code dans une réponse ni dans un journal ; aucune route ne lit ni n'écrit un
//     code de l'extérieur.
import { randomInt, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { HttpError, audit, body, text } from './lib.js'
import { normalizePhone } from './phone.js'
import { hashPassword, passwordProblem, createLimiter, rateLimitKey } from './security.js'
import { consumeQuota } from './quotas.js'
import { smsTexts, smsLang } from './sms.js'

const PUBLIC = { config: { public: true } }
export const CODE_MINUTES = 5
export const CODE_ATTEMPTS = 5
// Durées plancher des réponses : au-dessus du coût d'un hachage scrypt (~150 à 300 ms) et
// des quelques requêtes de la branche la plus longue.
const REGISTER_FLOOR_MS = 900
const RESEND_FLOOR_MS = 500
const GENERIC_SMS = 'Si ce numéro attend une confirmation, un code vient de lui être envoyé par SMS.'
const invalidCode = () => new HttpError(400, 'Code invalide ou expiré. Demandez-en un nouveau.', 'invalid_code')

async function floor(started, ms) {
  const left = ms - (Date.now() - started)
  if (left > 0) await delay(left)
}

export function createPhoneCodes(db, dataKey) {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(dataKey, 'hex'), Buffer.alloc(0), 'akaiky:phone-codes', 32))
  const hash = (phone, purpose, code) => createHmac('sha256', key).update(`${purpose}:${phone}:${code}`).digest()
  return {
    // Nouveau code : remplace le précédent du même usage, essais remis à zéro (le nombre
    // d'envois par numéro borne donc le nombre total d'essais).
    async issue(phone, purpose) {
      const code = String(randomInt(0, 1000000)).padStart(6, '0')
      await db.query(
        `INSERT INTO phone_codes(phone, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))
         ON CONFLICT (phone, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0,
           expires_at = EXCLUDED.expires_at, created_at = now()`,
        [phone, purpose, hash(phone, purpose, code), CODE_MINUTES])
      return code
    },
    // Un essai compté atomiquement AVANT la comparaison (le 6e trouve le code supprimé ou
    // épuisé), puis consommation par DELETE … RETURNING : deux confirmations simultanées du
    // bon code → une seule réussit. Le DELETE vise aussi l'empreinte lue : un code émis
    // entre-temps n'est jamais consommé par la comparaison d'un ancien.
    async consume(phone, purpose, code) {
      const { rows: [row] } = await db.query(
        `UPDATE phone_codes SET attempts = attempts + 1
          WHERE phone = $1 AND purpose = $2 AND expires_at > now() AND attempts < $3
          RETURNING id, code_hash, attempts`, [phone, purpose, CODE_ATTEMPTS])
      if (!row) return false
      if (timingSafeEqual(row.code_hash, hash(phone, purpose, code))) {
        const done = await db.query('DELETE FROM phone_codes WHERE id = $1 AND code_hash = $2 RETURNING 1', [row.id, row.code_hash])
        return done.rowCount === 1
      }
      if (row.attempts >= CODE_ATTEMPTS) await db.query('DELETE FROM phone_codes WHERE id = $1 AND code_hash = $2', [row.id, row.code_hash])
      return false
    }
  }
}

export async function phoneRoutes(app, { limit, queue }) {
  const { db, config, sms } = app
  const texts = smsTexts(config.appName)
  const codes = createPhoneCodes(db, config.dataKey)
  const perIpSms = createLimiter({ max: config.limits.smsPerIp, windowMs: 60 * 60 * 1000 })
  const phoneOf = (v) => normalizePhone(v, config.phoneCountry)
  const available = () => {
    if (!sms.available) throw new HttpError(503, 'Les SMS sont indisponibles pour le moment. Utilisez une adresse email.', 'sms_unavailable')
  }

  // Budget d'un SMS pour ce numéro, pris AVANT de savoir s'il a un compte : la limite ne
  // révèle rien. IP d'abord (mémoire), numéro ensuite (en base, une seule requête atomique :
  // fenêtre d'une heure et délai minimal), total enfin.
  async function sendBudget(req, phone) {
    if (!perIpSms(rateLimitKey(req.ip))) throw new HttpError(429, 'Trop de SMS demandés. Réessayez plus tard.', 'sms_rate_limited')
    const { rows } = await db.query(
      `INSERT INTO phone_send_limits(phone, sends, window_expires_at, last_sent_at) VALUES ($1, 1, now() + interval '1 hour', now())
       ON CONFLICT (phone) DO UPDATE SET
         sends = CASE WHEN phone_send_limits.window_expires_at <= now() THEN 1 ELSE phone_send_limits.sends + 1 END,
         window_expires_at = CASE WHEN phone_send_limits.window_expires_at <= now() THEN now() + interval '1 hour' ELSE phone_send_limits.window_expires_at END,
         last_sent_at = now()
       WHERE phone_send_limits.last_sent_at <= now() - make_interval(secs => $3)
         AND (phone_send_limits.window_expires_at <= now() OR phone_send_limits.sends < $2)
       RETURNING sends`, [phone, config.limits.smsPerNumber, config.limits.smsCooldownSeconds])
    if (!rows.length) throw new HttpError(429, 'Trop de SMS pour ce numéro. Réessayez dans quelques minutes.', 'sms_rate_limited')
    await consumeQuota(db, 'sms', config.quotas.smsPerHour)
  }

  async function sendCode(phone, lang) {
    const code = await codes.issue(phone, 'confirm')
    await sms.send({ to: phone, text: texts.confirm(code, lang) })
  }

  app.post('/phone/register', PUBLIC, async (req, reply) => {
    const started = Date.now()
    const b = body(req, ['phone', 'name', 'password', 'consent', 'lang'])
    const phone = phoneOf(b.phone)
    limit(req, phone)
    const name = text(b.name, { max: 80, min: 1, field: 'Nom' })
    const problem = passwordProblem(b.password)
    if (problem) throw new HttpError(400, problem)
    // Comme l'adresse d'un compte à adresse (passwordProblem) : l'identifiant, connu de tous
    // les contacts du titulaire, ne fait pas un mot de passe. Numéro national (9 derniers
    // chiffres), quelle que soit sa présentation dans le mot de passe.
    if (b.password.replace(/[\s.\-()/+]/g, '').includes(phone.slice(1).slice(-9))) {
      throw new HttpError(400, 'Le mot de passe ne doit pas contenir votre numéro de téléphone.')
    }
    // Comme pour l'adresse (NAR-178) : vérifié avant toute lecture de la base.
    if (b.consent !== true) throw new HttpError(400, 'Cochez la case de consentement pour créer un compte.', 'consent_required')
    const lang = smsLang(b.lang)
    available()
    await sendBudget(req, phone)
    await consumeQuota(db, 'registrations', config.quotas.registrationsPerHour)
    // Hachage calculé dans les deux cas (numéro neuf ou déjà pris).
    const hash = await hashPassword(b.password)
    // Un numéro déjà pris, confirmé ou non, n'est jamais repris ni modifié : sinon un tiers
    // remplacerait le mot de passe d'une inscription en attente que le vrai titulaire confirme.
    const { rows } = await db.query(
      `INSERT INTO users(phone, name, password_hash, consent_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (phone) DO NOTHING RETURNING id`, [phone, name, hash])
    const created = rows[0]?.id
    queue.enqueue(async () => {
      if (created) {
        await audit(db, req, 'register_phone', created)
        await sendCode(phone, lang)
      } else {
        await sms.send({ to: phone, text: texts.alreadyRegistered(lang) })
      }
    })
    await floor(started, REGISTER_FLOOR_MS)
    return reply.code(202).send({ codeRequired: true, message: 'Un code de confirmation vous a été envoyé par SMS.' })
  })

  // Pas de session ouverte : on se connecte ensuite avec numéro et mot de passe (comme /confirm).
  app.post('/phone/confirm', PUBLIC, async (req) => {
    const b = body(req, ['phone', 'code'])
    const phone = phoneOf(b.phone)
    limit(req, phone)
    if (typeof b.code !== 'string' || !/^\d{6}$/.test(b.code)) throw invalidCode()
    if (!await codes.consume(phone, 'confirm', b.code)) throw invalidCode()
    const { rows: [u] } = await db.query(
      'UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE phone = $1 RETURNING id', [phone])
    if (!u) throw invalidCode()
    await audit(db, req, 'phone_confirmed', u.id)
    return { message: 'Numéro confirmé. Vous pouvez vous connecter.', phone }
  })

  app.post('/phone/resend', PUBLIC, async (req, reply) => {
    const started = Date.now()
    const b = body(req, ['phone', 'lang'])
    const phone = phoneOf(b.phone)
    limit(req, phone)
    const lang = smsLang(b.lang)
    available()
    await sendBudget(req, phone)
    queue.enqueue(async () => {
      const u = (await db.query('SELECT id FROM users WHERE phone = $1 AND phone_verified_at IS NULL', [phone])).rows[0]
      if (u) await sendCode(phone, lang)
    })
    await floor(started, RESEND_FLOOR_MS)
    return reply.code(202).send({ message: GENERIC_SMS })
  })
}
