import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { API_BASE } from '../api/base'
import { createDeviceSession } from './deviceSession'

// Une seule session d'appareil pour toute l'app : le verrou de renouvellement et le
// jeton d'accès en mémoire sont partagés, quel que soit le nombre d'écrans montés.
export const deviceSession = createDeviceSession({
  base: API_BASE,
  store: {
    get: (k) => SecureStorage.get(k),
    set: async (k, v) => { await SecureStorage.set(k, v) },
    remove: async (k) => { await SecureStorage.remove(k) }
  },
  fetch: (...args) => fetch(...args)
})
