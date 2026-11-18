import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { API_BASE } from '../api/base'
import { createConfigSync } from './deviceConfig'
import { createUnlockGuard } from './unlockGuard'
import { createCallJournal, type DeviceEvent } from './callJournal'
import { uuidV4 } from './uuid'
import { AkaikyCall } from '../native/akaikyCall'
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
  onReset: async () => { await configSync.clear(); await childIdentity.clear(); await callJournal.clear() }
})
export const configSync = createConfigSync({ session: deviceSession, store: secureStore })

// Journal des appels sortants (NAR-166) : file dans le Keystore, envoyée par lots.
export const callJournal = createCallJournal({
  store: secureStore,
  post: (events: DeviceEvent[]) => deviceSession.post('/device/events', { events }),
  lastOutgoing: (number, since, until) => AkaikyCall.lastOutgoing({ number, since, ...(until === undefined ? {} : { until }) }),
  now: () => Date.now(),
  uuid: uuidV4
})

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

// Essais du code parent sur le téléphone (NAR-167) : compteur gardé dans le Keystore.
// Pas effacé avec la session : un réappairage ne remet pas les essais à zéro.
export const unlockGuard = createUnlockGuard({ store: secureStore, now: () => Date.now() })

// Hachage du code parent (NAR-167), gardé à part de la configuration : il survit à une
// session perdue (retrait, panne), pour que le parent puisse toujours sortir du verrou.
// Effacé seulement quand le téléphone est libéré (disarm), après saisie du code.
const PARENT_CODE_KEY = 'parent-code'
export const parentCodeStore = {
  async get(): Promise<string | null> {
    const v = await secureStore.get(PARENT_CODE_KEY).catch(() => null)
    return typeof v === 'string' && v.startsWith('pbkdf2-sha256$') ? v : null
  },
  set: (hash: string) => secureStore.set(PARENT_CODE_KEY, hash),
  clear: () => secureStore.remove(PARENT_CODE_KEY).catch(() => {})
}

// Pays des numéros (numéro d'urgence) gardé de même : le bouton « Secours » des écrans
// d'erreur d'un téléphone verrouillé compose le bon numéro national.
const COUNTRY_KEY = 'device-country'
export const countryStore = {
  async get(): Promise<string | null> {
    const v = await secureStore.get(COUNTRY_KEY).catch(() => null)
    return typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : null
  },
  set: (country: string) => secureStore.set(COUNTRY_KEY, country).catch(() => {})
}

// Dernière demande de déverrouillage à distance appliquée (NAR-168), identifiée par son
// échéance : une même demande n'est jamais appliquée deux fois (relecture du cache au
// démarrage, « Reverrouiller » avant l'échéance).
const REMOTE_SEEN_KEY = 'remote-unlock-seen'
// Gardée enveloppée (JSON) : le greffon de stockage relit une date ISO nue en objet Date,
// et la comparaison échouait (demande réappliquée, vu sur émulateur).
export const remoteUnlockSeen = {
  async get(): Promise<string | null> {
    const v = await secureStore.get(REMOTE_SEEN_KEY).catch(() => null)
    try {
      const until = typeof v === 'string' ? JSON.parse(v)?.until : null
      return typeof until === 'string' ? until : null
    } catch {
      return null
    }
  },
  set: (until: string) => secureStore.set(REMOTE_SEEN_KEY, JSON.stringify({ until }))
}
