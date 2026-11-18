import { DeviceError, type DeviceSession, type SecretStore } from './deviceSession'

// Configuration du téléphone de l'enfant (NAR-160) : contacts autorisés, version.
// Relevée avec ETag (304 si inchangée) et gardée pour fonctionner hors ligne.
// Décision : le cache va dans le stockage sécurisé (Keystore), comme la session :
// ce sont des données de mineurs (noms et numéros), jamais en localStorage.
export interface DeviceContact { id: string, name: string, phone: string, position: number, avatarColor: string }
export interface DeviceConfig { version: number, contacts: DeviceContact[] }
export const CONFIG_KEY = 'device-config'

interface Cached { etag: string | null, config: DeviceConfig }

const valid = (v: unknown): v is Cached => {
  const c = (v as Cached | null)?.config
  return !!c && typeof c.version === 'number' && Array.isArray(c.contacts)
    && c.contacts.every((x) => typeof x?.id === 'string' && typeof x.name === 'string' && typeof x.phone === 'string')
}

export function createConfigSync({ session, store }: { session: DeviceSession, store: SecretStore }) {
  let cached: Cached | null = null

  return {
    // Dernière configuration connue, lue du stockage (validée : une valeur abîmée est ignorée).
    async load(): Promise<DeviceConfig | null> {
      try {
        const raw = await store.get(CONFIG_KEY)
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : null
        cached = valid(parsed) ? parsed : null
      } catch {
        cached = null
      }
      return cached?.config ?? null
    },

    // Relevé : nouvelle configuration, ou `null` si inchangée. Hors ligne : erreur levée,
    // le cache reste. Téléphone retiré (401) : cache effacé, plus aucune donnée gardée.
    async refresh(): Promise<DeviceConfig | null> {
      try {
        const res = await session.getIfChanged<DeviceConfig>('/device/config', cached?.etag ?? null)
        if (!res) return null
        cached = { etag: res.etag, config: res.data }
        await store.set(CONFIG_KEY, JSON.stringify(cached)).catch(() => {})
        return res.data
      } catch (e) {
        if (e instanceof DeviceError && e.status === 401) {
          cached = null
          await store.remove(CONFIG_KEY).catch(() => {})
        }
        throw e
      }
    }
  }
}
