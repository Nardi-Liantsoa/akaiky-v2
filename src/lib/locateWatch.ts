import type { Fix } from '../native/akaikyLocation'

// Position à la demande, côté téléphone de l'enfant (NAR-204). À chaque tour (minuteur de
// l'écran au premier plan ; plus tard le réveil push `locate`, NAR-179) : GET /device/locate
// dit qui regarde et si un relevé est dû ; s'il l'est, un relevé unique (natif) part vers
// POST /device/positions. Jamais de relevé sans demande : c'est le serveur qui le dit dû, et
// il refuserait un relevé hors demande (409 no_request). Aucune position gardée ici.
export const LOCATE_POLL_MS = 15_000

export interface LocateStatus { pending: boolean, watchers: { name: string }[], watchingUntil: string | null, watchingForMs?: number }
// `forMs` : durée restante de la consultation (horloge du serveur), à décompter avec une
// horloge monotone ; jamais comparée à l'heure du téléphone, souvent fausse.
export interface Watching { names: string[], forMs: number }
// Après un relevé impossible (dedans, sans GPS), tours sans relevé : le GPS se repose
// (relevé de 20 s au plus toutes les ~60 s au lieu de toutes les 15 s).
export const FIX_BACKOFF_TICKS = 3

export function createLocateWatch({ get, post, fix, cancelFix, onWatching }: {
  get(path: string): Promise<LocateStatus>
  post(path: string, body: Fix): Promise<unknown>
  fix(): Promise<Fix>
  // Relevé natif en cours abandonné (arrêt : arrière-plan, session perdue).
  cancelFix(): Promise<unknown>
  // Qui regarde, dès la lecture de l'état (avant le relevé) : l'enfant le voit tout de suite.
  onWatching(w: Watching | null): void
}) {
  let running: Promise<void> | null = null
  // Chaque arrêt change de génération : un tour commencé avant ne publie ni n'envoie plus rien.
  let generation = 0
  let resting = 0

  async function run(gen: number) {
    let status: LocateStatus
    // Hors ligne ou session perdue : l'indicateur s'efface seul à la fin de la consultation.
    try { status = await get('/device/locate') } catch { return }
    if (gen !== generation) return
    const forMs = typeof status.watchingForMs === 'number' && Number.isFinite(status.watchingForMs) ? Math.min(status.watchingForMs, 10 * 60_000) : 0
    const names = Array.isArray(status.watchers) ? status.watchers.map((w) => String(w?.name ?? '')).filter(Boolean) : []
    onWatching(names.length && forMs > 0 ? { names, forMs } : null)
    if (status.pending !== true) { resting = 0; return }
    if (resting > 0) { resting--; return }
    let reading: Fix
    try { reading = await fix() } catch (e) {
      // Repos du GPS seulement après un vrai échec de relevé de ce tour-ci : un relevé
      // abandonné par un arrêt (`cancelled`) ou déjà en cours (`busy`) n'en est pas un.
      const code = (e as { code?: string } | null)?.code
      if (gen === generation && code !== 'cancelled' && code !== 'busy') resting = FIX_BACKOFF_TICKS
      return
    }
    if (gen !== generation) return
    // Âge mesuré par le natif (secondes entières). Le trajet réseau n'est pas mesurable d'ici :
    // l'heure du relevé gardée par le serveur peut être récente de quelques secondes de trop.
    const body = reading
    // Refus du serveur (consultation finie, relevé dépassé ou trop vieux, limite) : rien à
    // refaire ici, le tour suivant relit l'état.
    await post('/device/positions', body).catch(() => {})
  }

  return {
    // Un seul tour à la fois : un appel pendant un tour reçoit le même.
    tick(): Promise<void> {
      if (running) return running
      // Ce tour-ci seulement : un tour d'avant un arrêt ne libère pas celui d'après.
      const current: Promise<void> = run(generation).finally(() => { if (running === current) running = null })
      running = current
      return current
    },
    // Arrêt : le tour en cours ne publie ni n'envoie plus rien, le relevé natif est abandonné.
    stop() {
      generation++
      running = null
      resting = 0
      onWatching(null)
      void cancelFix().catch(() => {})
    }
  }
}
