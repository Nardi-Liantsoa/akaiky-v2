import { DeviceError } from './deviceSession'
import type { Fix } from '../native/akaikyLocation'

// SOS en ligne, côté téléphone de l'enfant (NAR-248). Lancé avec le SOS hors ligne (NAR-151,
// service natif : SMS, cascade, sirène), jamais avant lui ni à sa place : rien ici ne retarde
// l'appui de 3 s. Ouvre l'alerte sur le serveur (retentée sans réseau, même clientId : une
// seule alerte), envoie la position tout de suite puis toutes les 30 s, pendant 15 min au plus
// ou jusqu'à ce que le serveur dise l'alerte terminée (prise en charge, annulée, échue).
// Au premier plan : la WebView peut être ralentie quand le composeur est devant (cascade).
export const SOS_ONLINE_MS = 15 * 60_000
export const POSITION_EVERY_MS = 30_000
export const OPEN_RETRY_MS = 5_000
// « Annuler » compte s'il est touché dans les 5 s qui suivent l'appui (comme le serveur) ; une
// annulation touchée plus tard, ou qui n'a pu partir, laisse l'alerte aux parents.
export const CANCEL_WINDOW_MS = 5_000
export const CANCEL_RETRY_MS = 1_000
export const CANCEL_RETRY_FOR_MS = 10_000

export function createSosOnline({ post, fix, cancelFix, uuid }: {
  post(path: string, body?: unknown): Promise<unknown>
  fix(): Promise<Fix>
  cancelFix(): Promise<unknown>
  uuid(): string
}) {
  let generation = 0
  let running = false
  let id: string | null = null
  let opening: Promise<string | null> | null = null
  let wantCancel = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let startedAt = 0
  let endAt = 0
  let cancelAt = 0

  const sleep = (ms: number, gen: number) => new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(gen === generation), ms)
  })
  const finish = () => {
    generation++
    running = false
    clearTimeout(timer)
    void cancelFix().catch(() => {})
  }
  // Alerte finie pour le serveur (prise en charge, annulée, échue, inconnue) ou session perdue ;
  // un relevé refusé seul (`stale_position`) ne l'est pas.
  const closed = (e: unknown) => e instanceof DeviceError
    && (e.status === 401 || e.status === 404 || (e.status === 409 && (e.code === 'sos_closed' || e.code === 'sos_not_found')))

  async function open(clientId: string, gen: number): Promise<string | null> {
    while (gen === generation && Date.now() < endAt) {
      try {
        const res = await post('/device/sos', { clientId }) as { id?: unknown }
        if (typeof res?.id === 'string') return res.id
      } catch (e) {
        // Session perdue, téléphone retiré : rien ne passera.
        if (closed(e)) return null
      }
      if (!(await sleep(OPEN_RETRY_MS, gen))) return null
    }
    return null
  }

  async function run(gen: number) {
    const clientId = uuid()
    opening = open(clientId, gen)
    const opened = await opening
    opening = null
    if (gen !== generation) return
    if (!opened) { finish(); return }
    id = opened
    // Annulé par l'enfant dans les 5 s, avant que l'alerte soit ouverte (réseau lent ou absent) :
    // annulée dès son ouverture. Touché plus tard : l'alerte reste aux parents.
    if (wantCancel && cancelAt - startedAt <= CANCEL_WINDOW_MS && !(await sendCancel(gen))) return
    while (gen === generation && Date.now() < endAt) {
      let reading: Fix | null = null
      try { reading = await fix() } catch { /* relevé impossible : ce tour n'envoie rien */ }
      if (gen !== generation) return
      if (reading) {
        try { await post(`/device/sos/${id}/positions`, reading) } catch (e) {
          // Alerte terminée (prise en charge, annulée, échue) : plus rien à envoyer.
          if (closed(e)) { finish(); return }
        }
      }
      if (!(await sleep(POSITION_EVERY_MS, gen))) return
    }
    if (gen === generation) finish()
  }

  // Vrai si l'alerte reste ouverte. Refus du serveur (trop tard) : elle reste aux parents ;
  // échec du réseau : renvoyée chaque seconde pendant 10 s (le serveur juge le délai).
  async function sendCancel(gen: number): Promise<boolean> {
    const until = Date.now() + CANCEL_RETRY_FOR_MS
    while (gen === generation) {
      try {
        await post(`/device/sos/${id}/cancel`)
        if (gen === generation) finish()
        return false
      } catch (e) {
        if (e instanceof DeviceError && e.status === 409) return gen === generation
        if (closed(e)) { if (gen === generation) finish(); return false }
      }
      if (Date.now() >= until || !(await sleep(CANCEL_RETRY_MS, gen))) return gen === generation
    }
    return false
  }

  return {
    start() {
      if (running) return
      running = true
      wantCancel = false
      id = null
      startedAt = Date.now()
      endAt = startedAt + SOS_ONLINE_MS
      void run(++generation)
    },
    // « Annuler » de l'enfant.
    async cancel() {
      if (!running || wantCancel) return
      wantCancel = true
      cancelAt = Date.now()
      if (cancelAt - startedAt > CANCEL_WINDOW_MS) return
      // Pas encore ouverte : annulée par run() dès son ouverture (jamais attendue ici).
      if (opening) return
      if (id) await sendCancel(generation)
    },
    // Session perdue, écran démonté : tout s'arrête, rien n'est annulé chez les parents.
    stop() { if (running) finish() },
    active: () => running
  }
}
