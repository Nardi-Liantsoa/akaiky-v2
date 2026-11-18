import { reactive } from 'vue'
import { DeviceError } from '../lib/deviceSession'
import type { DeviceConfig } from '../lib/deviceConfig'

// Configuration du téléphone de l'enfant, partagée par l'app (singleton : un seul
// relevé à la fois). Relevé toutes les 30 s au premier plan, suspendu en arrière-plan
// (C15 : un changement du parent arrive en moins d'une minute si le téléphone est
// connecté). Le réveil par notification silencieuse viendra avec NAR-141.
export const POLL_MS = 30_000

export interface ConfigSync { load(): Promise<DeviceConfig | null>, refresh(): Promise<DeviceConfig | null> }

export const deviceConfig = reactive({
  config: null as DeviceConfig | null,
  // offline : dernier relevé en échec, la liste affichée est la dernière connue.
  status: 'idle' as 'idle' | 'ready' | 'offline' | 'lost'
})

let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | null = null
let source: ConfigSync | null = null

function poll(): Promise<void> {
  running ??= (async () => {
    try {
      const fresh = await source!.refresh()
      if (fresh) deviceConfig.config = fresh
      deviceConfig.status = 'ready'
    } catch (e) {
      // Téléphone retiré : plus de données gardées, plus de relevé.
      if (e instanceof DeviceError && e.status === 401) { deviceConfig.config = null; deviceConfig.status = 'lost'; pause() }
      else deviceConfig.status = 'offline'
    } finally {
      running = null
    }
  })()
  return running
}

// Premier plan : relevé immédiat puis toutes les 30 s.
export function resume() {
  if (!source || deviceConfig.status === 'lost' || timer) return
  void poll()
  timer = setInterval(() => { void poll() }, POLL_MS)
}

export function pause() {
  clearInterval(timer)
  timer = undefined
}

// Démarre avec la dernière configuration connue (hors ligne), puis relève.
// Rappelée à chaque (ré)appairage : repart de l'état « inactif », même après « perdu ».
export async function startDeviceConfig(sync: ConfigSync) {
  pause()
  source = sync
  deviceConfig.config = await sync.load()
  deviceConfig.status = 'idle'
}

// Tests : état et minuteries remis à zéro.
export function resetDeviceConfig() {
  pause()
  source = null
  running = null
  deviceConfig.config = null
  deviceConfig.status = 'idle'
}
