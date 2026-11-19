import type { AkaikyBackgroundPlugin } from '../native/akaikyBackground'

// Jeton « signal de vie » du natif en arrière-plan (NAR-180). L'écran l'obtient par SA
// session d'appareil (POST /api/device/heartbeat-token) et le confie au natif, qui n'utilise
// jamais la session elle-même : aucune rotation croisée, aucun rejeu possible.
// Émis une fois par lancement de l'app appairée, puis de nouveau quand le natif le dit perdu
// (`needsToken` : refusé ou illisible) ou arrêté. Hors ligne : nouvel essai au retour au
// premier plan. Un arrêt (session perdue, libération) annule une émission en cours.
export function createBackgroundStatus({ session, plugin, apiBase }: {
  session: { post<T>(path: string, body: unknown): Promise<T> },
  plugin: Pick<AkaikyBackgroundPlugin, 'startBackgroundStatus' | 'stopBackgroundStatus' | 'status'>,
  apiBase: string
}) {
  let issued = false
  let generation = 0
  let running: Promise<void> | null = null
  let runningGen = 0

  async function issue(gen: number) {
    const { token } = await session.post<{ token: string }>('/device/heartbeat-token', {})
    if (gen !== generation) return
    await plugin.startBackgroundStatus({ apiBase, token })
    if (gen === generation) issued = true
  }

  return {
    // Téléphone appairé (démarrage, retour au premier plan) : jeton émis si besoin.
    ensure(): Promise<void> {
      // Une émission à la fois ; celle d'avant un arrêt ne compte plus (elle abandonne seule).
      if (running && runningGen === generation) return running
      const gen = generation
      const run = (async () => {
        try {
          if (issued) {
            const s = await plugin.status()
            if (s.enabled && !s.needsToken) return
            if (gen !== generation) return
          }
          await issue(gen)
        } catch {
          // Hors ligne, greffon absent (web, coque plus ancienne) : nouvel essai plus tard.
        } finally {
          if (runningGen === gen) running = null
        }
      })()
      running = run
      runningGen = gen
      return run
    },
    // Plus de session (attente, expiré, retiré) ou téléphone libéré.
    async stop(): Promise<void> {
      generation++
      issued = false
      await plugin.stopBackgroundStatus().catch(() => {})
    }
  }
}
