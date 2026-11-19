import { loadConfig } from './config.js'
import { createPool, migrate, verifySchema } from './db.js'
import { createMailer } from './mailer.js'
import { buildApp } from './app.js'
import { startJobs } from './jobs.js'

const config = loadConfig()
const db = createPool(config.databaseUrl)

// La base peut démarrer après l'application (et un redémarrage de la base ne
// doit pas tuer l'API) : on réessaie. En mode `verify`, l'application ne joue
// aucune migration : elle vérifie qu'elles sont passées et que son rôle SQL
// n'est pas privilégié (voir ops/runtime-role.sql).
async function waitForDb(log) {
  for (let i = 1; ; i++) {
    try { await (config.migrations === 'verify' ? verifySchema(db) : migrate(db)); return } catch (e) {
      if (i >= 30) throw e
      log.warn({ attempt: i, err: e.message }, 'base indisponible, nouvel essai')
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

const mailLog = { info: (obj, msg) => console.log(JSON.stringify({ level: 30, time: Date.now(), msg, ...obj })) }
const app = await buildApp({ config, db, mailer: createMailer(config, mailLog), dbReady: false })
// Écoute immédiate : /health répond même si la base n'est pas encore là.
await app.listen({ port: config.port, host: '0.0.0.0' })
// Purge à échéance (NAR-153) : lancée une fois la base prête, arrêtée avec l'API.
// Rien n'est lancé si l'arrêt a déjà commencé.
let stopJobs = async () => {}
let stopping = false
waitForDb(app.log).then(() => {
  if (stopping) return
  app.dbReady = true; app.log.info('base prête'); stopJobs = startJobs(db, app.log)
})
  .catch((e) => { app.log.fatal({ err: e.message }, 'base injoignable'); process.exit(1) })

// Arrêt propre sur SIGTERM (NosyHost, docker stop) : PID 1 dans le conteneur.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    stopping = true
    app.log.info({ sig }, 'arrêt')
    // HTTP cesse d'accepter tout de suite, même pendant une purge (jusqu'à 10 min) ;
    // le pool ne ferme qu'une fois le tour de purge en cours fini.
    try { await Promise.all([app.close(), stopJobs()]); await db.end() } finally { process.exit(0) }
  })
}
