import type { DeviceStatus } from '../native/akaikyDevice'

// Signal de vie du téléphone de l'enfant (NAR-147) : batterie, réseau, carte SIM, envoyés
// à POST /api/device/heartbeat tant que l'app est au premier plan. Le serveur en tire les
// alertes (batterie < 15 %, carte SIM absente, silence de 60 minutes). La surveillance en
// arrière-plan, écran éteint, est native (NAR-180, BackgroundStatus.kt) : mêmes règles.
//
// Envoi au démarrage, puis au plus tard toutes les 15 minutes ; tout de suite quand la
// batterie passe sous 15 % ou que l'état de la carte SIM change. Hors ligne : rien n'est
// noté, le relevé suivant (chaque minute) réessaie. Relevé natif en échec : le signal part
// quand même (batterie et charge inconnues, carte SIM et réseau 'unknown', réseau 'none'
// si le navigateur se sait hors ligne) : le téléphone est vivant, c'est l'essentiel.
// `background` n'est jamais envoyé ici (le serveur garde la valeur déjà posée) : seule la surveillance native
// en arrière-plan (NAR-180) l'envoie à vrai et active l'alerte « silence ».
export const HEARTBEAT_EVERY_MS = 15 * 60_000
// Envoi sans réponse au-delà : abandonné (compté comme un échec), pour qu'un envoi bloqué
// ne fige jamais le verrou « un envoi à la fois ».
export const HEARTBEAT_TIMEOUT_MS = 20_000
export const BATTERY_LOW = 15

export type SimState = 'ready' | 'absent' | 'locked' | 'unknown'
export interface HeartbeatBody {
  batteryPct: number | null
  charging: boolean | null
  network: 'wifi' | 'mobile' | 'none' | 'unknown'
  simState: SimState
}

const SIM_STATES: SimState[] = ['ready', 'absent', 'locked', 'unknown']

// Relevé natif → corps attendu par le serveur. « other » (Ethernet, VPN…) : une connexion
// qui n'est pas celle de l'opérateur, comptée avec le Wi-Fi. Pas de relevé (natif en
// échec) : tout inconnu ; `online` (navigator.onLine) donne seulement « aucun réseau ».
export function heartbeatBody(s: DeviceStatus | null, online?: boolean): HeartbeatBody {
  if (!s) return { batteryPct: null, charging: null, network: online === false ? 'none' : 'unknown', simState: 'unknown' }
  const pct = typeof s.battery === 'number' && Number.isFinite(s.battery) && s.battery >= 0 && s.battery <= 100 ? Math.round(s.battery) : null
  return {
    batteryPct: pct,
    charging: typeof s.charging === 'boolean' ? s.charging : null,
    network: s.network === 'cellular' ? 'mobile' : s.network === 'none' ? 'none' : 'wifi',
    simState: s.simState && SIM_STATES.includes(s.simState) ? s.simState : 'unknown'
  }
}

export interface LastBeat { at: number, body: HeartbeatBody }

export function heartbeatDue(last: LastBeat | null, next: HeartbeatBody, now: number): boolean {
  if (!last) return true
  if (now - last.at >= HEARTBEAT_EVERY_MS || now < last.at) return true
  if (next.simState !== last.body.simState) return true
  const wasLow = last.body.batteryPct !== null && last.body.batteryPct < BATTERY_LOW
  const isLow = next.batteryPct !== null && next.batteryPct < BATTERY_LOW
  return isLow && !wasLow
}

const browserOnline = () => typeof navigator === 'undefined' ? undefined : navigator.onLine

// Un envoi à la fois ; le dernier envoi réussi sert de référence. reset() (session
// effacée) change de génération : un envoi parti avant et terminé après n'écrit pas `last`
// (la nouvelle session repart d'un premier signal).
export function createHeartbeat({ post, now, online = browserOnline, timeoutMs = HEARTBEAT_TIMEOUT_MS }: {
  post: (body: HeartbeatBody) => Promise<unknown>, now: () => number, online?: () => boolean | undefined, timeoutMs?: number
}) {
  let last: LastBeat | null = null
  let inflight = false
  let generation = 0
  return {
    // Renvoie vrai si un signal est parti. `status` null : relevé natif en échec.
    async tick(status: DeviceStatus | null): Promise<boolean> {
      if (inflight) return false
      const body = heartbeatBody(status, status ? undefined : online())
      const at = now()
      if (!heartbeatDue(last, body, at)) return false
      inflight = true
      const gen = generation
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        // deviceSession.post n'accepte pas de signal d'abandon : course avec un délai. La
        // requête abandonnée peut encore aboutir côté serveur ; elle n'est simplement pas notée.
        await Promise.race([post(body), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs) })])
        if (gen !== generation) return false
        last = { at, body }
        return true
      } catch {
        return false
      } finally {
        clearTimeout(timer)
        if (gen === generation) inflight = false
      }
    },
    reset() { generation++; last = null; inflight = false }
  }
}
