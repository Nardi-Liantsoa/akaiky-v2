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

// Démarre la tâche ; renvoie la fonction d'arrêt (SIGTERM), qui attend la fin du tour en
// cours. Le minuteur ne retient pas le processus ; jamais deux tours à la fois ici.
export function startJobs(db, log, { everyMs = RETENTION_EVERY_MS } = {}) {
  let running = null
  const tick = () => {
    if (running) return
    running = runRetention(db, log).finally(() => { running = null })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await running
  }
}
