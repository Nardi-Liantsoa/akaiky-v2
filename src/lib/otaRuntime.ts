import { App } from '@capacitor/app'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import type { AppKind } from './appKind'
import { readShell } from './otaTarget'
import { CHILD_APPLY_DELAY_MS, createOtaUpdater, type OtaStorage } from './otaUpdate'
import { AkaikyUpdate } from '../native/akaikyUpdate'

// Branchement du runtime OTA (NAR-191, src/lib/otaUpdate.ts) : au démarrage et à chaque retour
// au premier plan ; app enfant, installation 5 s après un passage en arrière-plan, au repos.
// Appelé par main.ts APRÈS notifyAppReady(), sans être attendu.

// État de l'écran de l'enfant (SOS en train d'être lancé, démarrage en cours), posé par
// ChildHomeView. Tant qu'il n'est pas posé : occupé (on échoue fermé).
let screenBusy: () => boolean = () => true
export function setOtaScreenBusy(fn: () => boolean) { screenBusy = fn }

const storage: OtaStorage = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* stockage indisponible */ } }
}

// Coque enfant : SOS ou appel en cours lus par le natif (AkaikyUpdate.status().busy) ; absent
// (coque antérieure) ou illisible : occupé.
async function childBusy(): Promise<boolean> {
  if (screenBusy()) return true
  const s = await AkaikyUpdate.status().catch(() => null)
  return s?.busy !== false
}

let started = false
export function startOtaRuntime(kind: AppKind) {
  if (started) return
  started = true
  const ota = createOtaUpdater({
    plugin: CapacitorUpdater,
    kind,
    updateUrl: __AKAIKY_OTA_UPDATE_URL__,
    shell: readShell,
    busy: kind === 'enfant' ? childBusy : async () => false,
    storage
  })
  void ota.check()
  let applyTimer: ReturnType<typeof setTimeout> | undefined
  App.addListener('appStateChange', ({ isActive }) => {
    clearTimeout(applyTimer)
    if (isActive) { void ota.check(); return }
    // Toujours en arrière-plan au moment d'installer (relu par applyStaged juste avant set()) : un
    // minuteur gelé qui part à la reprise ne recharge jamais l'écran sous les yeux de l'enfant.
    if (kind === 'enfant') {
      applyTimer = setTimeout(() => {
        void ota.applyStaged(async () => !(await App.getState()).isActive).catch(() => {})
      }, CHILD_APPLY_DELAY_MS)
    }
  }).catch(() => {})
}
