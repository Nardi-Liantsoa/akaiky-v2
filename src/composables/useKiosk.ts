import { reactive } from 'vue'
import type { AkaikyKioskPlugin, KioskStatus } from '../native/kiosk'

// État du mode appareil dédié sur le téléphone de l'enfant (NAR-167), partagé par
// l'écran d'accueil et le clavier de déverrouillage (singleton). Le natif fait foi :
// chaque action renvoie son état réel. La sortie temporaire est refermée ici à son
// échéance quand l'écran est affiché, et par une alarme native sinon.
export const kiosk = reactive({ status: null as KioskStatus | null })

let plugin: AkaikyKioskPlugin | null = null
let relock: ReturnType<typeof setTimeout> | undefined

function apply(s: KioskStatus) {
  kiosk.status = s
  clearTimeout(relock)
  relock = undefined
  if (s.unlockedUntil !== undefined) {
    relock = setTimeout(() => { void lockNow() }, Math.max(0, s.unlockedUntil - Date.now()))
  }
  return s
}

// Appelé au démarrage de l'écran de l'enfant (téléphone de l'enfant seulement).
export function useKioskPlugin(p: AkaikyKioskPlugin | null) {
  plugin = p
  if (!p) { clearTimeout(relock); kiosk.status = null }
}

const run = async (action: (p: AkaikyKioskPlugin) => Promise<KioskStatus>) => (plugin ? apply(await action(plugin)) : null)

export const refreshKiosk = () => run((p) => p.status())
export const armKiosk = () => run((p) => p.arm())
export const disarmKiosk = () => run((p) => p.disarm())
export const unlockKiosk = (minutes = 15) => run((p) => p.unlockFor({ minutes }))
export const lockNow = () => run((p) => p.lockNow())
export const isUnlocked = () => kiosk.status?.unlockedUntil !== undefined
