import { HttpError } from './lib.js'
import { securityAlert } from './login-guard.js'

const ALERTS = { registrations: 'registrations_quota', 'auth-emails': 'auth_emails_quota', 'invitation-emails': 'invitation_emails_quota' }

// UPSERT atomique : ni les requêtes concurrentes ni un redémarrage ne remettent
// le quota à zéro. Les noms sont constants, jamais fournis par les visiteurs.
export async function consumeQuota(db, name, max) {
  const { rows } = await db.query(`
    INSERT INTO security_quotas(name, hits, expires_at) VALUES ($1, 1, now() + interval '1 hour')
    ON CONFLICT (name) DO UPDATE SET
      hits = CASE WHEN security_quotas.expires_at <= now() THEN 1 ELSE security_quotas.hits + 1 END,
      expires_at = CASE WHEN security_quotas.expires_at <= now() THEN now() + interval '1 hour' ELSE security_quotas.expires_at END
    WHERE security_quotas.expires_at <= now() OR security_quotas.hits < $2
    RETURNING hits`, [name, max])
  if (!rows.length || rows[0].hits >= max) await securityAlert(db, ALERTS[name] ?? 'auth_emails_quota')
  if (!rows.length) throw new HttpError(429, 'Service temporairement limité. Réessayez plus tard.')
}

// Travail d’authentification asynchrone borné : la réponse HTTP ne dépend ni
// de l’existence du compte ni de la latence SMTP. Pas de promesses illimitées.
export function createAuthQueue(log) {
  const jobs = [], idle = []
  let running = 0
  const pump = () => {
    while (running < 2 && jobs.length) {
      const job = jobs.shift(); running++
      Promise.resolve().then(job).catch(() => log.error('Échec d’un email d’authentification'))
        .finally(() => { running--; pump(); if (!running && !jobs.length) idle.splice(0).forEach(r => r()) })
    }
  }
  return {
    enqueue(job) {
      if (running + jobs.length >= 32) throw new HttpError(503, 'Service occupé. Réessayez dans quelques instants.')
      jobs.push(job); pump()
    },
    drain() { return running || jobs.length ? new Promise(resolve => idle.push(resolve)) : Promise.resolve() }
  }
}
