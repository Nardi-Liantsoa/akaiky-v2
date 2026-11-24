import type { Fix } from '../native/akaikyLocation'

// Position à la demande, côté téléphone de l'enfant (NAR-204). À chaque tour (minuteur de
// l'écran au premier plan ; plus tard le réveil push `locate`, NAR-179) : GET /device/locate
// dit qui regarde et si un relevé est dû ; s'il l'est, un relevé unique (natif) part vers
// POST /device/positions. Jamais de relevé sans demande : c'est le serveur qui le dit dû, et
// il refuserait un relevé hors demande (409 no_request). Aucune position gardée ici.
export const LOCATE_POLL_MS = 15_000

export interface LocateStatus { pending: boolean, watchers: { name: string }[], watchingUntil: string | null }
export interface Watching { names: string[], until: number }

export function createLocateWatch({ get, post, fix, cancelFix, onWatching, clock = () => performance.now() }: {
  get(path: string): Promise<LocateStatus>
  post(path: string, body: Fix): Promise<unknown>
  fix(): Promise<Fix>
  // Relevé natif en cours abandonné (arrêt : arrière-plan, session perdue).
  cancelFix(): Promise<unknown>
  // Qui regarde, dès la lecture de l'état (avant le relevé) : l'enfant le voit tout de suite.
  onWatching(w: Watching | null): void
  // Horloge monotone de l'écran (ms), pour vieillir le relevé jusqu'à son envoi.
  clock?: () => number
}) {
  let running: Promise<void> | null = null
  // Chaque arrêt change de génération : un tour commencé avant ne publie ni n'envoie plus rien.
  let generation = 0

  async function run(gen: number) {
    let status: LocateStatus
    // Hors ligne ou session perdue : l'indicateur s'efface seul à la fin de la consultation.
    try { status = await get('/device/locate') } catch { return }
    if (gen !== generation) return
    const until = status.watchingUntil ? Date.parse(status.watchingUntil) : NaN
    const names = Array.isArray(status.watchers) ? status.watchers.map((w) => String(w?.name ?? '')).filter(Boolean) : []
    onWatching(names.length && Number.isFinite(until) ? { names, until } : null)
    if (status.pending !== true) return
    let reading: Fix
    try { reading = await fix() } catch { return }
    const takenAt = clock()
    if (gen !== generation) return
    // Âge recalculé juste avant l'envoi, arrondi au-dessus : une attente (réseau, session
    // renouvelée) ne rajeunit jamais le relevé aux yeux du serveur.
    const body = { ...reading, ageS: reading.ageS + Math.ceil(Math.max(0, clock() - takenAt) / 1000) }
    // Refus du serveur (consultation finie, relevé dépassé ou trop vieux, limite) : rien à
    // refaire ici, le tour suivant relit l'état.
    await post('/device/positions', body).catch(() => {})
  }

  return {
    // Un seul tour à la fois : un appel pendant un tour reçoit le même.
    tick(): Promise<void> {
      const gen = generation
      running ??= run(gen).finally(() => { running = null })
      return running
    },
    // Arrêt : le tour en cours ne publie ni n'envoie plus rien, le relevé natif est abandonné.
    stop() {
      generation++
      running = null
      onWatching(null)
      void cancelFix().catch(() => {})
    }
  }
}
