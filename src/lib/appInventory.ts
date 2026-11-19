import type { LaunchableApp } from '../native/kiosk'
import type { AllowedApp } from './deviceConfig'
import type { SecretStore } from './deviceSession'

// Applications du téléphone de l'enfant (NAR-143). L'inventaire (paquet, nom, icône ; jamais
// de donnée d'usage) part au serveur quand il change, repéré par son empreinte, pour que le
// parent choisisse les applications autorisées. Mêmes bornes que le serveur (routes/apps.js) :
// une entrée hors bornes est écartée ici plutôt que de faire refuser tout l'envoi.
export const MAX_INVENTORY = 150
const MAX_LABEL = 80
// 4 Ko de PNG en base64.
const MAX_ICON_CHARS = Math.ceil(4096 / 3) * 4
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/
const PNG_B64 = 'iVBORw0KGgo'
export const INVENTORY_KEY = 'apps-inventory'

const cleanLabel = (s: string) => [...s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, MAX_LABEL).join('').trim()

export function prepareInventory(apps: readonly LaunchableApp[]): LaunchableApp[] {
  const seen = new Set<string>()
  const out: LaunchableApp[] = []
  for (const a of apps) {
    if (typeof a?.package !== 'string' || a.package.length > 200 || !PACKAGE_RE.test(a.package) || seen.has(a.package)) continue
    const label = typeof a.label === 'string' ? cleanLabel(a.label) : ''
    if (!label) continue
    seen.add(a.package)
    const icon = typeof a.icon === 'string' && a.icon.length <= MAX_ICON_CHARS && a.icon.startsWith(PNG_B64) ? a.icon : null
    // Navigateur : marqué seulement quand c'en est un (empreinte inchangée pour les autres).
    out.push(a.browser === true ? { package: a.package, label, icon, browser: true } : { package: a.package, label, icon })
  }
  // Ordre stable (empreinte indépendante de l'ordre rendu par Android).
  return out.sort((x, y) => (x.package < y.package ? -1 : x.package > y.package ? 1 : 0)).slice(0, MAX_INVENTORY)
}

export async function inventoryHash(apps: readonly LaunchableApp[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(apps.map((a) => (a.browser ? [a.package, a.label, a.icon, 1] : [a.package, a.label, a.icon]))))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Envoi seulement si l'inventaire a changé depuis le dernier envoi réussi pour CET enfant
// (le serveur en accepte 6 par heure). L'empreinte n'est gardée qu'après la réponse du serveur.
// Appelé pendant un envoi : un seul envoi de suite, ensuite, avec les derniers arguments reçus
// (jamais un inventaire plus récent perdu, jamais deux envois en parallèle).
type SyncResult = 'sent' | 'unchanged'
export function createInventorySync({ store, put }: { store: SecretStore, put: (body: { apps: LaunchableApp[] }) => Promise<unknown> }) {
  let running: Promise<SyncResult> | null = null
  let queued: { childId: string, apps: readonly LaunchableApp[], promise: Promise<SyncResult> } | null = null
  async function last(): Promise<{ childId: string, hash: string } | null> {
    try {
      const raw = await store.get(INVENTORY_KEY)
      const v = typeof raw === 'string' ? JSON.parse(raw) : null
      return typeof v?.childId === 'string' && typeof v?.hash === 'string' ? v : null
    } catch {
      return null
    }
  }
  async function once(childId: string, apps: readonly LaunchableApp[]): Promise<SyncResult> {
    const prepared = prepareInventory(apps)
    const hash = await inventoryHash(prepared)
    const prev = await last()
    if (prev?.childId === childId && prev.hash === hash) return 'unchanged'
    await put({ apps: prepared })
    await store.set(INVENTORY_KEY, JSON.stringify({ childId, hash })).catch(() => {})
    return 'sent'
  }
  function start(childId: string, apps: readonly LaunchableApp[]): Promise<SyncResult> {
    const p = once(childId, apps)
    running = p
    const done = () => { if (running === p) running = null }
    p.then(done, done)
    return p
  }
  return {
    sync(childId: string, apps: readonly LaunchableApp[]): Promise<SyncResult> {
      if (!running) return start(childId, apps)
      if (queued) {
        queued.childId = childId
        queued.apps = apps
        return queued.promise
      }
      const q = { childId, apps, promise: null as unknown as Promise<SyncResult> }
      q.promise = running.then(() => {}, () => {}).then(() => {
        queued = null
        return start(q.childId, q.apps)
      })
      queued = q
      running = q.promise
      return q.promise
    },
    clear: () => store.remove(INVENTORY_KEY).catch(() => {})
  }
}

export interface AppTile { package: string, label: string, icon: string | null }

// Rangée d'applications de l'accueil : celles autorisées par le parent, dans son ordre, et
// présentes sur CE téléphone (icône lue sur place). Aucune pendant une plage « école » (seuls
// les parents et le SOS restent, NAR-148) : la rangée seule est masquée, les applications ne
// sont pas recachées par le natif (elles restent seulement hors de portée de l'écran).
export function appsRow(allowed: readonly AllowedApp[] | undefined, local: readonly LaunchableApp[], school: boolean): AppTile[] {
  if (school || !allowed?.length) return []
  // Marquée `browser` par le natif (protégée : navigateur ou liste fixe, AppsPolicy.isProtected) :
  // jamais de tuile, même autorisée avant d'être reconnue comme telle (le natif refuse de l'ouvrir).
  const here = new Map(local.filter((a) => a.browser !== true).map((a) => [a.package, a]))
  return [...allowed]
    .sort((a, b) => a.position - b.position)
    .filter((a) => here.has(a.package))
    .map((a) => ({ package: a.package, label: a.label, icon: here.get(a.package)?.icon ?? null }))
}
