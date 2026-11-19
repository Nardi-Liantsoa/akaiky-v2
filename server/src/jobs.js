import { PUSH_EVERY_MS, runPushWorker } from './push.js'

// Tâches planifiées (NAR-153). La purge à échéance tourne au démarrage puis toutes les
// heures ; la fonction SQL purge_expired() (016_retention.sql) décide si un tour est dû
// (au plus un toutes les 20 heures, une seule instance à la fois) et applique les durées
// de conservation, fixées dans la base. Un échec est journalisé et retenté à l'heure
// suivante ; il n'arrête jamais l'API.
export const RETENTION_EVERY_MS = 60 * 60_000

// Client dédié : la purge peut dépasser le statement_timeout de 15 s du pool (db.js) ;
// elle a droit à 10 minutes, rendues au pool une fois finie.
export async function runRetention(db, log) {
  let client
  try {
    client = await db.connect()
    await client.query("SET statement_timeout = '10min'")
    const { rows: [row] } = await client.query('SELECT purge_expired() AS result')
    await client.query('RESET statement_timeout')
    if (row.result) log.info({ retention: row.result }, 'purge à échéance')
    client.release()
    return row.result
  } catch (e) {
    // Connexion dans un état douteux (délai réglé à 10 min) : détruite, pas rendue.
    client?.release(e)
    log.error({ err: e.message }, 'purge à échéance en échec')
    return null
  }
}

// File des notifications push (NAR-141) : un tour toutes les 10 s, jamais deux à la fois
// ici (FOR UPDATE SKIP LOCKED entre instances). Un échec est journalisé, retenté au tour suivant.
export async function runPush(db, provider, config, log) {
  try {
    const summary = await runPushWorker(db, provider, config, log)
    if (summary.claimed) log.info({ push: summary }, 'notifications push')
    return summary
  } catch (e) {
    log.error({ err: e.message }, 'file push en échec')
    return null
  }
}

function every(ms, run) {
  let running = null
  const tick = () => {
    if (running) return
    running = run().finally(() => { running = null })
  }
  tick()
  const timer = setInterval(tick, ms)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await running
  }
}

// Démarre les tâches ; renvoie la fonction d'arrêt (SIGTERM), qui attend la fin des tours en
// cours. Les minuteurs ne retiennent pas le processus. `push` : { provider, config } ; absent,
// la file n'est pas traitée.
export function startJobs(db, log, { everyMs = RETENTION_EVERY_MS, push = null, pushEveryMs = PUSH_EVERY_MS } = {}) {
  const stops = [every(everyMs, () => runRetention(db, log))]
  if (push) stops.push(every(pushEveryMs, () => runPush(db, push.provider, push.config, log)))
  return async () => { await Promise.all(stops.map((stop) => stop())) }
}
