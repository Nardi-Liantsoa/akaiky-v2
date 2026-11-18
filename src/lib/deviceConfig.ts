import { DeviceError, type DeviceSession, type SecretStore } from './deviceSession'

// Configuration du téléphone de l'enfant (NAR-160) : contacts autorisés, version.
// Relevée avec ETag (304 si inchangée) et gardée pour fonctionner hors ligne.
// Décision : le cache va dans le stockage sécurisé (Keystore), comme la session :
// ce sont des données de mineurs (noms et numéros), jamais en localStorage.
// Le cache est lié à l'enfant : celui d'un autre enfant (téléphone réappairé) est ignoré.
export interface DeviceContact { id: string, name: string, phone: string, position: number, avatarColor: string }
// parentCode : hachage « pbkdf2-sha256$<itérations>$<sel>$<clé> » du code parent (NAR-139),
// vérifié hors ligne (NAR-167) ; null tant qu'aucun gestionnaire ne l'a défini. Absent d'une
// config mise en cache avant ce champ : équivaut à null (aucun code n'existait encore, et le
// premier code défini fait avancer la version, donc un relevé complet).
// remoteUnlockUntil : fin d'un déverrouillage demandé par un parent (NAR-168), appliqué une fois.
// messageTexts : textes modifiés des messages rapides, par emplacement (NAR-173).
export interface DeviceConfig { version: number, country?: string, parentCode?: string | null, remoteUnlockUntil?: string | null, messageTexts?: Record<string, string>, contacts: DeviceContact[] }
export const CONFIG_KEY = 'device-config'

interface Cached { childId: string, etag: string | null, config: DeviceConfig }

const valid = (v: unknown): v is Cached => {
  const c = (v as Cached | null)?.config
  return typeof (v as Cached | null)?.childId === 'string' && !!c && typeof c.version === 'number' && Array.isArray(c.contacts)
    && (c.parentCode === undefined || c.parentCode === null || typeof c.parentCode === 'string')
    && (c.remoteUnlockUntil === undefined || c.remoteUnlockUntil === null || typeof c.remoteUnlockUntil === 'string')
    && (c.messageTexts === undefined || (typeof c.messageTexts === 'object' && c.messageTexts !== null && Object.values(c.messageTexts).every((x) => typeof x === 'string')))
    && c.contacts.every((x) => typeof x?.id === 'string' && typeof x.name === 'string' && typeof x.phone === 'string')
}

export function createConfigSync({ session, store }: { session: DeviceSession, store: SecretStore }) {
  let cached: Cached | null = null
  let childId: string | null = null
  // Génération : un relevé lancé avant un clear() ou un changement d'enfant n'écrit rien.
  let generation = 0

  return {
    // Dernière configuration connue de CET enfant (validée ; une valeur abîmée ou d'un
    // autre enfant est ignorée).
    async load(forChild: string): Promise<DeviceConfig | null> {
      generation++
      childId = forChild
      try {
        const raw = await store.get(CONFIG_KEY)
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : null
        cached = valid(parsed) && parsed.childId === forChild ? parsed : null
      } catch {
        cached = null
      }
      return cached?.config ?? null
    },

    // Plus aucune donnée gardée (session perdue ou remplacée, téléphone non appairé).
    async clear(): Promise<void> {
      generation++
      cached = null
      childId = null
      await store.remove(CONFIG_KEY).catch(() => {})
    },

    // Relevé : nouvelle configuration, ou `null` si inchangée. Hors ligne : erreur levée,
    // le cache reste. Téléphone retiré (401) : la session efface le cache (clear).
    async refresh(): Promise<DeviceConfig | null> {
      const gen = generation
      const forChild = childId
      if (!forChild) return null
      const res = await session.getIfChanged<DeviceConfig>('/device/config', cached?.etag ?? null)
      if (!res || gen !== generation) return null
      // L'ETag n'avance que si la liste est bien enregistrée : sinon le relevé suivant
      // la redemande (200) et retente l'écriture, au lieu d'un 304 sur une liste perdue.
      const next = { childId: forChild, etag: res.etag, config: res.data }
      // Même contrôle qu'à la lecture : une réponse mal formée n'écrase pas un cache valable
      // (qui serait ensuite rejeté en entier au démarrage, contacts compris).
      if (!valid(next)) throw new Error('Configuration du téléphone mal formée.')
      const saved = await store.set(CONFIG_KEY, JSON.stringify(next)).then(() => true, () => false)
      if (gen !== generation) { await store.remove(CONFIG_KEY).catch(() => {}); return null }
      cached = saved ? next : { ...next, etag: null }
      return res.data
    }
  }
}

export type ConfigSyncApi = ReturnType<typeof createConfigSync>
export const isLost = (e: unknown) => e instanceof DeviceError && e.status === 401
