import { reactive } from 'vue'
import { isLost, type DeviceConfig } from '../lib/deviceConfig'

// Configuration du téléphone de l'enfant, partagée par l'app (singleton : un seul
// relevé à la fois). Relevé toutes les 30 s au premier plan, suspendu en arrière-plan
// (C15 : un changement du parent arrive en moins d'une minute si le téléphone est
// connecté). Le réveil par notification silencieuse viendra avec NAR-141.
export const POLL_MS = 30_000

export interface ConfigSync { load(childId: string): Promise<DeviceConfig | null>, refresh(): Promise<DeviceConfig | null> }

export const deviceConfig = reactive({
  config: null as DeviceConfig | null,
  // offline : dernier relevé en échec, la liste affichée est la dernière connue.
  status: 'idle' as 'idle' | 'ready' | 'offline' | 'lost'
})

let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | null = null
let source: ConfigSync | null = null
// Génération : un relevé lancé avant un redémarrage n'applique pas son résultat.
let generation = 0

function poll(): Promise<void> {
  const gen = generation
  running ??= (async () => {
    try {
      const fresh = await source!.refresh()
      if (gen !== generation) return
      if (fresh) deviceConfig.config = fresh
      deviceConfig.status = 'ready'
    } catch (e) {
      if (gen !== generation) return
      // Téléphone retiré : plus de données gardées, plus de relevé.
      if (isLost(e)) { deviceConfig.config = null; deviceConfig.status = 'lost'; pause() }
      else deviceConfig.status = 'offline'
    } finally {
      running = null
    }
  })()
  return running
}

// Relevé tout de suite, hors du rythme de 30 s (réveil push `config`, NAR-179) : seulement au
// premier plan (minuteur posé) ; un relevé déjà en cours est réutilisé.
export function refreshNow(): Promise<void> {
  if (!source || deviceConfig.status === 'lost' || !timer) return Promise.resolve()
  return poll()
}

// Relevé même en arrière-plan (NAR-216) : pendant une sortie du verrou, l'enfant est dans une
// autre app ; l'ordre de reverrouillage d'un parent doit passer sans attendre son retour.
// Au mieux : Android peut ralentir ou suspendre la WebView en arrière-plan.
export function pollNow(): Promise<void> {
  if (!source || deviceConfig.status === 'lost') return Promise.resolve()
  return poll()
}

// Premier plan : relevé immédiat puis toutes les 30 s (sans effet pendant un chargement).
export function resume() {
  if (!source || deviceConfig.status === 'lost' || timer) return
  void poll()
  timer = setInterval(() => { void poll() }, POLL_MS)
}

export function pause() {
  clearInterval(timer)
  timer = undefined
}

// Rappelée à chaque (ré)appairage : dernière liste connue de cet enfant, puis relevés
// (resume) ; repart de l'état « inactif », même après « perdu ».
export async function startDeviceConfig(sync: ConfigSync, childId: string) {
  pause()
  generation++
  running = null
  source = null
  const gen = generation
  const config = await sync.load(childId)
  if (gen !== generation) return
  deviceConfig.config = config
  deviceConfig.status = 'idle'
  source = sync
}

// Plus d'enfant appairé : relevés arrêtés, rien d'affiché.
export function stopDeviceConfig() {
  pause()
  generation++
  source = null
  running = null
  deviceConfig.config = null
  deviceConfig.status = 'idle'
}

export const resetDeviceConfig = stopDeviceConfig
