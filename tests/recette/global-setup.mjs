// Recette sur le vrai back (starter app-propre) : PostgreSQL jetable,
// migrations par le compte propriétaire, rôle restreint de production
// (ops/runtime-role.sql), serveur lancé avec ce rôle (DB_MIGRATIONS=verify) et
// le front réellement construit. Les emails sont écrits dans un fichier
// (MAIL_OUTBOX, refusé en production) que les tests relisent.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPool, migrate } from '../../server/src/db.js'
import { STATE_FILE, RECETTE_PORT } from './env.mjs'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export default async function globalSetup() {
  const origin = `http://127.0.0.1:${RECETTE_PORT}`
  // Un serveur d'un passage précédent répondrait à /ready à la place du nôtre.
  if (await fetch(`${origin}/ready`).then(() => true, () => false)) throw new Error(`port ${RECETTE_PORT} déjà occupé : arrêter l'ancien serveur ou choisir RECETTE_PORT`)
  const dir = mkdtempSync(join(tmpdir(), 'recette-'))
  const name = `recette-db-${process.pid}`
  let server
  // Échec en cours de route : rien ne reste derrière (base et volume, serveur, fichiers).
  const cleanup = () => {
    try { server?.kill() } catch { /* déjà arrêté */ }
    try { execFileSync('docker', ['rm', '-fv', name], { stdio: 'ignore' }) } catch { /* jamais créé */ }
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    await start(dir, name, origin, (s) => { server = s })
  } catch (error) {
    cleanup()
    throw error
  }
}

async function start(dir, name, origin, onServer) {
  execFileSync('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=recette', '-e', 'POSTGRES_DB=recette',
    '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { stdio: 'ignore' })
  const dbPort = execFileSync('docker', ['port', name, '5432/tcp']).toString().trim().split(':').pop()
  const ownerUrl = `postgres://postgres:recette@127.0.0.1:${dbPort}/recette`
  const roleSql = readFileSync('ops/runtime-role.sql', 'utf8').replace(":'runtime_password'", "'recette-uniquement'")
  const role = /CREATE ROLE (\w+)/.exec(roleSql)?.[1]
  if (!role) throw new Error('ops/runtime-role.sql : rôle introuvable')
  const owner = createPool(ownerUrl)
  try {
    for (let i = 0; ; i++) {
      try { await owner.query('SELECT 1'); break } catch (e) { if (i > 60) throw e; await wait(500) }
    }
    await migrate(owner)
    await owner.query(roleSql)
  } finally { await owner.end() }

  // Front construit comme en production, servi par l'API (même origine).
  const dist = join(dir, 'dist')
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'], { stdio: 'inherit' })

  const outbox = join(dir, 'outbox.jsonl')
  writeFileSync(outbox, '')
  const server = spawn(process.execPath, ['server/src/server.js'], {
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(RECETTE_PORT), APP_ORIGIN: origin, STATIC_DIR: dist,
      DATABASE_URL: `postgres://${role}:recette-uniquement@127.0.0.1:${dbPort}/recette`,
      DB_MIGRATIONS: 'verify', MAIL_OUTBOX: outbox,
      // Les parcours enchaînent beaucoup de connexions depuis la même adresse.
      RATE_LIMIT_IP: '100000', RATE_LIMIT_EMAIL: '1000', REGISTRATIONS_PER_HOUR: '100000', AUTH_EMAILS_PER_HOUR: '100000', API_RATE_LIMIT: '100000'
    },
    stdio: ['ignore', 'ignore', 'inherit']
  })
  onServer(server)
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${origin}/ready`)).ok) break } catch { /* démarrage */ }
    if (i > 120) throw new Error('le serveur de recette ne démarre pas')
    await wait(250)
  }
  writeFileSync(STATE_FILE, JSON.stringify({ origin, outbox, ownerUrl, container: name, pid: server.pid, dir }))
}
