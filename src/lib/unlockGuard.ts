import type { SecretStore } from './deviceSession'

// Essais du code parent sur le téléphone (NAR-167) : cinq essais libres, puis un délai
// qui double à chaque erreur (30 s, 1 min, 2 min… 1 h au plus). Compteur gardé dans le
// stockage sécurisé : ni le redémarrage ni la fermeture de l'app ne le remettent à zéro.
// L'heure ne se règle pas à la main (restriction posée par le verrou) ; une remise à
// l'heure par le réseau peut seulement raccourcir une attente, jamais l'annuler.
export const FREE_ATTEMPTS = 5
export const BASE_DELAY_MS = 30_000
export const MAX_DELAY_MS = 60 * 60_000
export const GUARD_KEY = 'unlock-guard'

interface GuardState { failures: number, blockedUntil: number }

export const delayAfter = (failures: number) =>
  failures < FREE_ATTEMPTS ? 0 : Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_DELAY_MS)

export function createUnlockGuard({ store, now }: { store: SecretStore, now: () => number }) {
  const write = (s: GuardState) => store.set(GUARD_KEY, JSON.stringify(s))

  async function read(): Promise<GuardState> {
    let raw: unknown
    // Keystore illisible : pas de blocage (l'enfant ne peut pas provoquer cette panne,
    // et le parent ne doit pas rester enfermé dehors).
    try { raw = await store.get(GUARD_KEY) } catch { return { failures: 0, blockedUntil: 0 } }
    if (raw === null || raw === undefined) return { failures: 0, blockedUntil: 0 }
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : null
      if (Number.isInteger(v?.failures) && v.failures >= 0 && typeof v.blockedUntil === 'number') {
        // Jamais plus long que le délai maximal (valeur écrite avant un changement d'heure).
        return { failures: v.failures, blockedUntil: Math.min(v.blockedUntil, now() + MAX_DELAY_MS) }
      }
    } catch { /* abîmé */ }
    // Compteur abîmé : premier délai, réécrit en valeur saine (il expire, jamais un
    // blocage sans fin).
    const healed = { failures: FREE_ATTEMPTS, blockedUntil: now() + BASE_DELAY_MS }
    await write(healed).catch(() => {})
    return healed
  }
  return {
    // Temps d'attente restant avant le prochain essai (0 : essai permis).
    async waitMs(): Promise<number> {
      return Math.max(0, (await read()).blockedUntil - now())
    },
    // Mauvais code : compté AVANT tout affichage, pour qu'un arrêt de l'app ne l'efface pas.
    async fail(): Promise<number> {
      const s = await read()
      const failures = s.failures + 1
      const wait = delayAfter(failures)
      await write({ failures, blockedUntil: now() + wait })
      return wait
    },
    async succeed(): Promise<void> {
      await store.remove(GUARD_KEY)
    }
  }
}
