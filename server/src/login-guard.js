import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { HttpError } from './lib.js'

export const loginBucket = email => createHash('sha256').update(email).digest().readUInt16BE(0)
export const loginDelay = failures => failures < 10 ? 0 : Math.min(30, 2 ** Math.min(5, failures - 10))

export async function securityAlert(db, kind) {
  await db.query(`INSERT INTO security_alerts(kind) VALUES ($1)
    ON CONFLICT (kind) DO UPDATE SET last_seen=now(), occurrences=LEAST(security_alerts.occurrences+1,1000000000)`, [kind])
}

export function createLoginGuard(db) {
  // Quatre connexions DB réservées au plus ; les autres restent disponibles
  // aux sessions, projets, réinitialisations et contrôles de santé.
  let running = 0
  const waiting = new Set()
  const execute = async (email, verify, deviceId) => {
    if (running >= 4) throw new HttpError(503, 'Connexions occupées. Réessayez dans quelques instants.')
    running++
    let conn, locked = false
    const bucket = loginBucket(email)
    const lock = createHash('sha256').update('login:' + email + ':' + (deviceId || 'unknown')).digest().readBigInt64BE(0).toString()
    try {
      conn = await db.connect()
      locked = (await conn.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [lock])).rows[0].ok
      if (!locked) throw new HttpError(429, 'Une tentative est déjà en cours. Réessayez dans quelques instants.')
      // Un seul mot de passe peut être vérifié pour cette adresse à la fois,
      // même entre processus. Aucun verrou n’est gardé pendant un délai.
      const account = (await conn.query(`SELECT id,
        CASE WHEN locked_until < now()-interval '1 hour' THEN 0 ELSE failed_logins END AS failures,
        GREATEST(0, LEAST(30, COALESCE(EXTRACT(EPOCH FROM locked_until-now()),0))) AS wait
        FROM users WHERE email=$1`, [email])).rows[0]
      if (!account) await conn.query('INSERT INTO login_guards(bucket) VALUES ($1) ON CONFLICT DO NOTHING', [bucket])
      const device = deviceId ? (await conn.query(`SELECT id,
        CASE WHEN next_attempt_at < now()-interval '1 hour' THEN 0 ELSE failures END AS failures,
        GREATEST(0, LEAST(30, EXTRACT(EPOCH FROM next_attempt_at-now()))) AS wait
        FROM trusted_devices WHERE id=$1 AND user_id=$2 AND expires_at>now()`, [deviceId,account?.id])).rows[0] : null
      if (deviceId && !device) throw new HttpError(401, 'Appareil expiré. Recommencez la connexion.')
      const g = device || account || (await conn.query(`SELECT
        CASE WHEN updated_at < now()-interval '1 hour' THEN 0 ELSE failures END AS failures,
        GREATEST(0, LEAST(30, EXTRACT(EPOCH FROM next_attempt_at-now()))) AS wait
        FROM login_guards WHERE bucket=$1`, [bucket])).rows[0]
      if (Number(g.wait) > 0) return { deferMs: Number(g.wait) * 1000 }
      const result = await verify(conn, {
        async failed() {
          const failures = Math.min(g.failures + 1, 1000000)
          if (device) {
            await conn.query('UPDATE trusted_devices SET failures=$2,next_attempt_at=now()+make_interval(secs=>$3) WHERE id=$1',[device.id,failures,loginDelay(failures)])
          } else if (account) {
            await conn.query(`UPDATE users SET failed_logins=$2,locked_until=now()+make_interval(secs=>$3) WHERE id=$1`,
              [account.id, failures, loginDelay(failures)])
          } else await conn.query(`UPDATE login_guards SET failures=$2,
            next_attempt_at=now()+make_interval(secs=>$3), updated_at=now() WHERE bucket=$1`,
          [bucket, failures, loginDelay(failures)])
          return failures
        },
        async succeeded() {
          if (device) await conn.query('UPDATE trusted_devices SET failures=0,next_attempt_at=now() WHERE id=$1',[device.id])
          else if (account) await conn.query('UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=$1', [account.id])
          else await conn.query('UPDATE login_guards SET failures=0,next_attempt_at=now(),updated_at=now() WHERE bucket=$1', [bucket])
        }
      })
      return { result }
    } finally {
      if (conn) {
        // Si l’unlock échoue, détruire la connexion : ne jamais remettre dans le
        // pool une session portant encore un verrou.
        let broken = false
        if (locked) try { await conn.query('SELECT pg_advisory_unlock($1::bigint)', [lock]) } catch { broken = true }
        conn.release(broken)
      }
      running--
    }
  }
  return async (email, verify, deviceId) => {
    let outcome = await execute(email, verify, deviceId)
    const lane = email + ':' + (deviceId || 'unknown')
    if (outcome.deferMs) {
      if (waiting.has(lane) || waiting.size >= 64) throw new HttpError(429, 'Une tentative est déjà en attente. Réessayez dans quelques instants.')
      waiting.add(lane)
      try {
        // Attente mémoire bornée, sans connexion DB ni place de calcul occupée.
        await delay(Math.ceil(outcome.deferMs))
        outcome = await execute(email, verify, deviceId)
      } finally { waiting.delete(lane) }
      // Un autre processus a éventuellement consommé le créneau entre-temps.
      // Pas de boucle infinie ni de plusieurs vérifications du même mot de passe.
      if (outcome.deferMs) {
        const seconds = Math.ceil(outcome.deferMs / 1000)
        throw Object.assign(new HttpError(429, `Réessayez dans ${seconds} secondes.`), { retryAfter: seconds })
      }
    }
    return outcome.result
  }
}
