import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { API_BASE } from '../api/base'
import { createConfigSync } from './deviceConfig'
import { createDeviceSession, type SecretStore } from './deviceSession'

// Stockage sécurisé (Keystore) : session et configuration du téléphone de l'enfant.
export const secureStore: SecretStore = {
  get: (k) => SecureStorage.get(k),
  set: async (k, v) => { await SecureStorage.set(k, v) },
  remove: async (k) => { await SecureStorage.remove(k) }
}

// Une seule session d'appareil pour toute l'app : le verrou de renouvellement et le
// jeton d'accès en mémoire sont partagés, quel que soit le nombre d'écrans montés.
export const deviceSession = createDeviceSession({ base: API_BASE, store: secureStore, fetch: (...args) => fetch(...args) })

export const configSync = createConfigSync({ session: deviceSession, store: secureStore })
