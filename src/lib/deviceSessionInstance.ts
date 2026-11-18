import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { API_BASE } from '../api/base'
import { createConfigSync } from './deviceConfig'
import { createDeviceSession, type SecretStore } from './deviceSession'
import type { ChildIdentity } from './childStartup'

// Stockage sécurisé (Keystore) : session et configuration du téléphone de l'enfant.
export const secureStore: SecretStore = {
  get: (k) => SecureStorage.get(k),
  set: async (k, v) => { await SecureStorage.set(k, v) },
  remove: async (k) => { await SecureStorage.remove(k) }
}

// Une seule session d'appareil pour toute l'app : le verrou de renouvellement et le
// jeton d'accès en mémoire sont partagés, quel que soit le nombre d'écrans montés.
// Session perdue ou remplacée : la configuration gardée (contacts) est effacée.
export const deviceSession = createDeviceSession({
  base: API_BASE, store: secureStore, fetch: (...args) => fetch(...args),
  onReset: async () => { await configSync.clear(); await secureStore.remove(IDENTITY_KEY).catch(() => {}) }
})
export const configSync = createConfigSync({ session: deviceSession, store: secureStore })

// Enfant du téléphone (prénom, identifiant) : accueil ouvert sans Internet.
const IDENTITY_KEY = 'device-child'
export const childIdentity = {
  async get(): Promise<ChildIdentity | null> {
    const raw = await secureStore.get(IDENTITY_KEY)
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : null
      return typeof v?.childId === 'string' && typeof v?.firstName === 'string' ? { childId: v.childId, firstName: v.firstName } : null
    } catch {
      return null
    }
  },
  set: (v: ChildIdentity) => secureStore.set(IDENTITY_KEY, JSON.stringify(v)),
  clear: () => secureStore.remove(IDENTITY_KEY).catch(() => {})
}
