import { loadConfig } from './config.js'
import { createPool, migrate, verifySchema } from './db.js'
import { createMailer } from './mailer.js'
import { buildApp } from './app.js'

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
waitForDb(app.log).then(() => { app.dbReady = true; app.log.info('base prête') })
  .catch((e) => { app.log.fatal({ err: e.message }, 'base injoignable'); process.exit(1) })

// Arrêt propre sur SIGTERM (NosyHost, docker stop) : PID 1 dans le conteneur.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    app.log.info({ sig }, 'arrêt')
    try { await app.close(); await db.end() } finally { process.exit(0) }
  })
}
