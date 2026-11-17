// Arrêt du serveur de recette et suppression de la base jetable (volume compris).
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { state, STATE_FILE } from './env.mjs'

export default async function globalTeardown() {
  if (!existsSync(STATE_FILE)) return // mise en place échouée : elle a déjà tout nettoyé
  const s = state()
  try { process.kill(s.pid) } catch { /* déjà arrêté */ }
  try { execFileSync('docker', ['rm', '-fv', s.container], { stdio: 'ignore' }) } catch { /* déjà supprimé */ }
  rmSync(s.dir, { recursive: true, force: true })
  rmSync(STATE_FILE, { force: true })
}
