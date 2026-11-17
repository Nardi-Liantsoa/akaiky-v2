import { createMfa } from '../mfa.js'
import { recognizedDevice, rememberDevice } from '../devices.js'
import { readAuthCookie, authCookie } from '../auth-cookies.js'
import { HttpError, audit, me, emailAddress, text } from '../lib.js'
import { hashPassword, verifyPassword, burnPasswordTime, newToken, tokenHash, passwordProblem, createLimiter, rateLimitKey } from '../security.js'
import { authEmails } from '../mailer.js'
import { consumeQuota, createAuthQueue } from '../quotas.js'
import { createLoginGuard, securityAlert } from '../login-guard.js'
import { nativeRoutes } from '../native.js'
import { setTimeout as delay } from 'node:timers/promises'

// Réponse identique que l'adresse existe ou non : l'API ne révèle jamais
// quels emails ont un compte.
const GENERIC_SENT = 'Si cette adresse correspond à un compte, un email vient de lui être envoyé.'
const PUBLIC = { config: { public: true } }

const email = emailAddress

export default async function authRoutes(app) {
  const { db, config, mailer } = app
  const emails = authEmails(config.appName)
  const guardLogin = createLoginGuard(db)
  const queue = createAuthQueue(app.log)
  app.addHook('onClose', queue.drain)
  const emailBudget = () => consumeQuota(db, 'auth-emails', config.quotas.authEmailsPerHour)
  const perIp = createLimiter({ max: config.limits.perIp, windowMs: 15 * 60 * 1000 })
  const perEmail = createLimiter({ max: config.limits.perEmail, windowMs: 60 * 60 * 1000 })
  const limit = (req, key) => {
    if (!perIp(`${req.routeOptions.url}|${rateLimitKey(req.ip)}`)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.')
    if (key && !perEmail(`${req.routeOptions.url}|${key}`)) throw new HttpError(429, 'Trop de demandes pour cette adresse. Réessayez plus tard.')
  }
  // Le jeton voyage dans le fragment : il n'atteint ni les journaux ni le Referer.
  // L'origine vient de la configuration, jamais de l'en-tête Host.
  const link = (hash) => `${config.origin}/connexion#${hash}`

  async function issueToken(userId, purpose, hours) {
    await db.query('DELETE FROM user_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose])
    const { token, hash } = newToken()
    await db.query(
      `INSERT INTO user_tokens(token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
      [hash, userId, purpose, hours])
    return token
  }

  // Consomme un jeton en une seule requête : impossible de l'utiliser deux fois,
  // même avec deux requêtes simultanées.
  async function consumeToken(token, purpose, conn = db) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new HttpError(400, 'Lien invalide ou expiré.')
    const { rows } = await conn.query(
      `UPDATE user_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`, [tokenHash(token), purpose])
    if (!rows[0]) throw new HttpError(400, 'Lien invalide ou expiré. Demandez-en un nouveau.')
    return rows[0].user_id
  }

  async function openSession(reply, userId, conn = db, mfa = false) {
    // Nouveau jeton à chaque connexion : pas de fixation de session.
    const { token, hash } = newToken()
    await conn.query(
      `INSERT INTO sessions(token_hash, user_id, kind, expires_at, mfa_verified_at)
       VALUES ($1, $2, 'cookie', now() + make_interval(days => $3), CASE WHEN $4 THEN now() END)`,
      [hash, userId, config.session.idleDays, mfa])
    authCookie(reply, config, 'session', token, config.session.absoluteDays * 86400)
  }

  async function finishLogin(conn, req, reply, user, deviceId, remember, mfa = false) {
    await openSession(reply, user.id, conn, mfa)
    await rememberDevice(conn, req, reply, config, user.id, deviceId, remember)
    await audit(conn, req, 'login', user.id)
    return { user: me(user) }
  }
  const mfa = createMfa(app, finishLogin)

  // Vérifie email + mot de passe sous la garde de connexion, puis appelle
  // `accepted(conn, user)` dans une transaction qui verrouille l'utilisateur.
  // Partagé par la connexion web et la connexion de l'application native.
  async function checkCredentials(req, b, deviceId, accepted) {
    const e = email(b.email)
    if (typeof b.password !== 'string' || b.password.length > 200) throw new HttpError(400, 'Mot de passe requis.')
    return guardLogin(e, async (conn, guard) => {
      const u = (await conn.query('SELECT id, email, name, is_admin, password_hash, email_verified_at FROM users WHERE email=$1', [e])).rows[0]
      // Email inconnu : on vérifie quand même un hachage, pour que la durée ne trahisse rien.
      const valid = u ? await verifyPassword(b.password, u.password_hash) : (await burnPasswordTime(b.password), false)
      if (!valid) {
        const failures = await guard.failed()
        if (u) {
          if (failures >= 10) await securityAlert(conn, 'login_attack')
          await audit(conn, req, 'login_failed', u.id)
        }
        throw new HttpError(401, 'Email ou mot de passe incorrect.')
      }
      await guard.succeeded()
      // Contrôlé après le mot de passe : ne révèle rien à qui ne le connaît pas.
      if (!u.email_verified_at) throw new HttpError(403, 'Confirmez votre adresse email avant de vous connecter.')
      await conn.query('BEGIN')
      try {
        // Une réinitialisation ou promotion concurrente invalide l'ancien résultat.
        const current = (await conn.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [u.id])).rows[0]
        if (!current || current.password_hash !== u.password_hash) throw new HttpError(401, 'Recommencez la connexion.')
        const needsMfa = current.is_admin || !!(await conn.query('SELECT user_id FROM mfa_factors WHERE user_id=$1', [u.id])).rows[0]
        const result = await accepted(conn, current, needsMfa)
        await conn.query('COMMIT')
        return result
      } catch (error) { await conn.query('ROLLBACK'); throw error }
    }, deviceId)
  }

  app.get('/me', PUBLIC, async (req) => ({ user: req.user ? me(req.user) : null }))

  app.post('/register', PUBLIC, async (req, reply) => {
    const b = req.body || {}
    const e = email(b.email)
    limit(req, e)
    const name = text(b.name, { max: 80, min: 1, field: 'Nom' })
    const problem = passwordProblem(b.password, e)
    if (problem) throw new HttpError(400, problem)
    await consumeQuota(db, 'registrations', config.quotas.registrationsPerHour)
    await emailBudget()
    // Le hachage est calculé dans les deux cas (adresse neuve ou déjà prise).
    const hash = await hashPassword(b.password)
    const { rows } = await db.query(
      `INSERT INTO users(email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING id`, [e, name, hash])
    if (rows[0]) {
      const token = await issueToken(rows[0].id, 'confirm', 24)
      await mailer.send({ to: e, ...emails.confirm(link(`confirm=${token}`)) })
      await audit(db, req, 'register', rows[0].id)
    } else {
      await mailer.send({ to: e, ...emails.alreadyRegistered(link(''), link('forgot')) })
    }
    return reply.code(202).send({ confirmationRequired: true, message: 'Vérifiez votre boîte mail pour activer votre compte.' })
  })

  // POST et non GET : les antivirus de messagerie ouvrent les liens.
  app.post('/confirm', PUBLIC, async (req) => {
    limit(req)
    const userId = await consumeToken(req.body?.token, 'confirm')
    const { rows } = await db.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING email', [userId])
    await audit(db, req, 'email_confirmed', userId)
    // Le jeton prouve l'accès à la boîte : renvoyer l'adresse pour préremplir la connexion.
    return { message: 'Adresse confirmée. Vous pouvez vous connecter.', email: rows[0].email }
  })

  app.post('/resend-confirmation', PUBLIC, async (req, reply) => {
    const e = email(req.body?.email)
    limit(req, e)
    await emailBudget()
    queue.enqueue(async () => {
      const u = (await db.query('SELECT id FROM users WHERE email = $1 AND email_verified_at IS NULL', [e])).rows[0]
      if (u) {
        const token = await issueToken(u.id, 'confirm', 24)
        await mailer.send({ to: e, ...emails.confirm(link(`confirm=${token}`)) })
      }
    })
    // Délai fixe : la latence SMTP ne trahit pas l'existence du compte.
    await delay(500)
    return reply.code(202).send({ message: GENERIC_SENT })
  })

  app.post('/login', PUBLIC, async (req, reply) => {
    const b = req.body || {}
    limit(req)
    const deviceId = await recognizedDevice(db, req, config, email(b.email))
    return checkCredentials(req, b, deviceId, (conn, user, needsMfa) => needsMfa
      ? mfa.begin(conn, req, reply, user, deviceId, b.rememberDevice === true)
      : finishLogin(conn, req, reply, user, deviceId, b.rememberDevice === true))
  })

  app.post('/logout', PUBLIC, async (req, reply) => {
    if (req.sessionHash) await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash])
    const challenge = readAuthCookie(req, config, 'challenge')
    if (challenge) await db.query('DELETE FROM mfa_challenges WHERE token_hash=$1', [tokenHash(challenge)])
    authCookie(reply, config, 'session', '', 0)
    authCookie(reply, config, 'challenge', '', 0)
    return { ok: true }
  })

  app.post('/forgot-password', PUBLIC, async (req, reply) => {
    const e = email(req.body?.email)
    limit(req, e)
    await emailBudget()
    queue.enqueue(async () => {
      const u = (await db.query('SELECT id FROM users WHERE email = $1', [e])).rows[0]
      if (u) {
        const token = await issueToken(u.id, 'reset', 1)
        await mailer.send({ to: e, ...emails.reset(link(`reset=${token}`)) })
        await audit(db, req, 'reset_requested', u.id)
      }
    })
    await delay(500)
    return reply.code(202).send({ message: GENERIC_SENT })
  })

  // Ferme toutes les sessions (web et natives), révoque les appareils de
  // confiance, garde la MFA, n'ouvre pas de session.
  app.post('/reset-password', PUBLIC, async (req, reply) => {
    limit(req)
    const b = req.body || {}
    const pre = (await db.query(
      `SELECT u.email FROM user_tokens t JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.purpose = 'reset' AND t.used_at IS NULL AND t.expires_at > now()`,
      [tokenHash(String(b.token || ''))])).rows[0]
    const problem = passwordProblem(b.password, pre?.email || '')
    if (problem) throw new HttpError(400, problem)
    if (!pre) throw new HttpError(400, 'Lien invalide ou expiré.')
    const hash = await hashPassword(b.password)
    const conn = await db.connect()
    let changed
    try {
      await conn.query('BEGIN')
      // Même ordre de verrouillage que la connexion / MFA : utilisateur d'abord.
      const owner = (await conn.query('SELECT id FROM users WHERE email=$1 FOR UPDATE', [pre.email])).rows[0]
      const userId = await consumeToken(b.token, 'reset', conn)
      if (!owner || owner.id !== userId) throw new HttpError(400, 'Lien invalide.')
      changed = (await conn.query(`UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL,
        email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1 RETURNING email`, [userId, hash])).rows[0]
      await conn.query('DELETE FROM sessions WHERE user_id=$1', [userId])
      await conn.query('DELETE FROM trusted_devices WHERE user_id=$1', [userId])
      await conn.query('DELETE FROM mfa_challenges WHERE user_id=$1', [userId])
      await conn.query("DELETE FROM user_tokens WHERE user_id=$1 AND purpose='reset'", [userId])
      await audit(conn, req, 'password_reset', userId)
      await conn.query('COMMIT')
    } catch (error) { await conn.query('ROLLBACK'); throw error } finally { conn.release() }
    await mailer.send({ to: changed.email, ...emails.passwordChanged() })
    authCookie(reply, config, 'session', '', 0)
    return { message: 'Mot de passe modifié. Connectez-vous avec le nouveau mot de passe.' }
  })

  await nativeRoutes(app, { limit, checkCredentials })
}
