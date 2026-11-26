// État réel du verrou du téléphone de l'enfant, rapporté au serveur (NAR-216) : le parent
// voit la sortie en cours (code ou à distance) et peut la refermer à distance.
// Le téléphone n'envoie que des durées mesurées sur sa propre horloge (reste, ouverte depuis) :
// le serveur les place sur la sienne, et rend l'ouverture (unlockStartedAt). La demande de
// reverrouillage (relockRequestedAt de la configuration) vient de la même horloge : les deux se
// comparent sans dépendre de l'heure du téléphone.

// Une sortie dure 15 minutes au plus (NAR-167, NAR-168).
export const LOCK_MAX_S = 15 * 60

export type UnlockSource = 'code' | 'remote'
export type LockBody = { remainingS: 0 } | { remainingS: number, openedAgoS: number, source: UnlockSource }
// Sortie notée par l'écran (journal) : origine et ouverture sur l'horloge du téléphone.
export interface OpenWindow { source: UnlockSource, startedAt: number }

const clampS = (ms: number) => Math.min(LOCK_MAX_S, Math.max(0, Math.round(ms / 1000)))

// La sortie notée par l'écran est-elle celle du natif ? Son ouverture plus sa durée accordée
// tombent sur l'échéance du natif (à une minute près) ; sinon c'est une sortie plus ancienne,
// jamais refermée dans le journal, ou la nouvelle n'est pas encore notée.
export const WINDOW_MATCH_MS = 60_000
export function matchingWindow(unlockedUntil: number | undefined, window: (OpenWindow & { plannedS: number }) | null): OpenWindow | null {
  if (!window || unlockedUntil === undefined) return null
  return Math.abs(window.startedAt + window.plannedS * 1000 - unlockedUntil) <= WINDOW_MATCH_MS ? window : null
}

// Corps du rapport : verrouillé (échéance absente ou passée), sinon reste, ouverture et origine.
// Sortie pas encore notée (ou notée pour une autre) : ouverte « maintenant », origine code. Une
// ouverture trop tardive ne fait que laisser passer une demande de reverrouillage antérieure
// (la sortie se referme alors à son échéance) ; trop précoce, elle refermerait une sortie neuve.
// Le rapport exact suit dès que la sortie est notée.
export function lockBody(unlockedUntil: number | undefined, window: OpenWindow | null, now: number): LockBody {
  if (unlockedUntil === undefined || unlockedUntil <= now) return { remainingS: 0 }
  const remainingS = Math.max(1, Math.min(LOCK_MAX_S, Math.ceil((unlockedUntil - now) / 1000)))
  if (!window) return { remainingS, openedAgoS: 0, source: 'code' }
  return { remainingS, openedAgoS: clampS(now - window.startedAt), source: window.source }
}

// Reverrouiller : une demande d'un parent postérieure à l'ouverture de la sortie en cours
// (une demande plus ancienne visait une sortie précédente). Ouverture inconnue (rapport pas
// encore accepté) : rien ; la règle est relue dès que le rapport passe.
export function relockDue(relockRequestedAt: string | null | undefined, unlockStartedAt: string | null): boolean {
  if (!relockRequestedAt || !unlockStartedAt) return false
  const asked = Date.parse(relockRequestedAt), opened = Date.parse(unlockStartedAt)
  return !Number.isNaN(asked) && !Number.isNaN(opened) && asked > opened
}

// Envoi des rapports, un à la fois et dans l'ordre (le dernier état gagne) ; un état déjà
// accepté n'est pas renvoyé (clé), un échec est renvoyé au prochain appel.
export function createLockReporter({ send }: { send(body: LockBody): Promise<{ unlockStartedAt: string | null }> }) {
  let sentKey: string | null = null
  let started: string | null = null
  let chain: Promise<unknown> = Promise.resolve()
  let generation = 0
  return {
    // Vrai si l'état est connu du serveur (envoyé maintenant ou déjà).
    report(body: LockBody, key: string): Promise<boolean> {
      const gen = generation
      const run = async () => {
        if (gen !== generation) return false
        if (key === sentKey) return true
        try {
          const res = await send(body)
          if (gen !== generation) return false
          sentKey = key
          started = res.unlockStartedAt ?? null
          return true
        } catch {
          // Ouverture d'une autre sortie (ou verrouillé) : plus jamais comparée à la demande.
          if (key !== sentKey) { sentKey = null; started = null }
          return false
        }
      }
      const next = chain.then(run, run)
      chain = next.catch(() => {})
      return next
    },
    startedAt: () => started,
    reset() { generation++; sentKey = null; started = null }
  }
}
