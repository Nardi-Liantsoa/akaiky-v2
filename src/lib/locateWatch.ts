import type { Fix } from '../native/akaikyLocation'

// Position à la demande, côté téléphone de l'enfant (NAR-204). À chaque tour (minuteur de
// l'écran au premier plan ; plus tard le réveil push `locate`, NAR-179) : GET /device/locate
// dit qui regarde et si un relevé est dû ; s'il l'est, un relevé unique (natif) part vers
// POST /device/positions. Jamais de relevé sans demande : c'est le serveur qui le dit dû, et
// il refuserait un relevé hors demande (409 no_request). Aucune position gardée ici.
export const LOCATE_POLL_MS = 15_000

export interface LocateStatus { pending: boolean, watchers: { name: string }[], watchingUntil: string | null }
export interface Watching { names: string[], until: number }

export function createLocateWatch({ get, post, fix }: {
  get(path: string): Promise<LocateStatus>
  post(path: string, body: Fix): Promise<unknown>
  fix(): Promise<Fix>
}) {
  let running: Promise<void> | null = null
  let watching: Watching | null = null

  async function run() {
    let status: LocateStatus
    // Hors ligne ou session perdue : l'indicateur s'efface seul à la fin de la consultation.
    try { status = await get('/device/locate') } catch { return }
    const until = status.watchingUntil ? Date.parse(status.watchingUntil) : NaN
    const names = Array.isArray(status.watchers) ? status.watchers.map((w) => String(w?.name ?? '')).filter(Boolean) : []
    watching = names.length && Number.isFinite(until) ? { names, until } : null
    if (status.pending !== true) return
    let reading: Fix
    try { reading = await fix() } catch { return }
    // Refus du serveur (consultation finie, relevé déjà dépassé, limite) : rien à refaire ici,
    // le tour suivant relit l'état.
    await post('/device/positions', reading).catch(() => {})
  }

  return {
    // Un seul tour à la fois : un appel pendant un tour reçoit le même.
    tick(): Promise<void> {
      running ??= run().finally(() => { running = null })
      return running
    },
    // Noms affichés par l'indicateur tant que la consultation dure ; vide ensuite.
    watchers(now: number): string[] {
      return watching && watching.until > now ? watching.names : []
    },
    clear() { watching = null }
  }
}
