import type { BundleInfo, CapacitorUpdaterPlugin, LatestVersion } from '@capgo/capacitor-updater'
import type { AppKind } from './appKind'
import { otaVerdict, targetFromData, type OtaVerdict, type Shell } from './otaTarget'

// Runtime des mises à jour OTA (NAR-191) : demander au serveur Akaiky le dernier bundle
// (getLatest du greffon, qui appelle `updateUrl`), le refuser s'il ne vise pas cette coque
// (otaVerdict), le télécharger avec son SHA-256, puis le faire prendre sans jamais interrompre :
//  - app parent (Android, iOS) : `next()`. Le greffon 8.54.2 l'installe au prochain passage en
//    arrière-plan (installNext, Android et iOS), jamais devant l'utilisateur ;
//  - app enfant : jamais `next()`, car ce passage en arrière-plan est justement un appel (écran
//    d'appel par-dessus) ou un SOS. Le bundle reste téléchargé, et l'écran l'installe (`set()`)
//    5 s après un passage en arrière-plan (écran éteint, app autorisée ouverte), seulement si
//    toujours en arrière-plan et au repos : aucun appel, aucun SOS (natif, illisible = occupé).
// Garde-fou du greffon : un bundle qui n'appelle pas notifyAppReady() à temps (appReadyTimeout,
// 10 s ; au moins 30 s au premier lancement d'un bundle sur Android 8.54.2, délai compté au premier
// plan) est annulé et marqué en échec ; sa version n'est plus jamais retéléchargée.
// Docs : docs/MOBILE.md « Mises à jour OTA ».

// Au plus une vérification toutes les 6 heures (comme l'APK enfant, NAR-170) : quatre requêtes
// par jour et par appareil au plus, un correctif arrive dans la journée.
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
// Délai en arrière-plan avant l'installation sur l'app enfant (appel qui démarre : le temps que
// Telecom le signale).
export const CHILD_APPLY_DELAY_MS = 5000
// Le greffon Android 8.54.2 attend la fin du téléchargement sans délai maximal (CapgoUpdater.download,
// tâche WorkManager) : au-delà, la vérification est abandonnée et le verrou rendu, sinon une tâche
// bloquée empêcherait toute vérification et toute installation jusqu'au prochain rechargement. Un zip
// qui arrive plus tard reste vérifié par son empreinte et est repris comme un bundle déjà téléchargé.
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const LAST_CHECK_KEY = 'akaiky.ota.lastCheckAt'
const FAILED_KEY = 'akaiky.ota.failedVersions'
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/
const CHECKSUM_RE = /^[0-9a-f]{64}$/

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })
  return Promise.race([p, expired]).finally(() => clearTimeout(timer))
}

// Barrière Capgo : rien n'est demandé tant que l'`updateUrl` des coques n'est pas le serveur
// Akaiky (NAR-190). Sans `updateUrl`, le greffon vise Capgo Cloud (plugin.capgo.app) : l'adresse
// est lue au build dans capacitor.config.ts (vite.config.ts, __AKAIKY_OTA_UPDATE_URL__), la même
// source que la configuration native écrite par `cap sync`. Accepté : https://<hôte>/api/ota/latest
// (jamais capgo.app), ou http://127.0.0.1:<port>/api/ota/latest (test local par adb reverse, que
// seule la coque debug laisse passer en clair). Jamais un hôte .invalid (adresse provisoire).
export function akaikyUpdateUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw === '') return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.pathname !== '/api/ota/latest' || u.search || u.hash || u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  if (host === 'capgo.app' || host.endsWith('.capgo.app')) return null
  // Adresse provisoire (domaine pas encore choisi) : aucune requête vouée à l'échec.
  if (host.endsWith('.invalid')) return null
  if (u.protocol === 'https:') return u
  if (u.protocol === 'http:' && host === '127.0.0.1' && u.port !== '') return u
  return null
}

// Cible annoncée par la réponse : `data` (chaînes, seule forme que le greffon iOS transmet) sur
// les deux plateformes. Si `target` arrive aussi (Android le transmet tel quel), il doit dire
// exactement la même chose ; sinon, ou sans `data`, aucune cible (verdict invalid).
export function targetFromLatest(latest: LatestVersion & { data?: unknown, target?: unknown }): unknown {
  const t = targetFromData(latest.data) as Record<string, unknown> | null
  if (!t) return null
  if (latest.target !== undefined) {
    const o = latest.target as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || Object.keys(o).length !== 3
      || o.app !== t.app || o.channel !== t.channel || o.minNativeBuild !== t.minNativeBuild) return null
  }
  return t
}

// Dernière vérification dans le futur (horloge reculée) : ne bloque pas indéfiniment.
export function dueForCheck(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || lastCheckAt > now || now - lastCheckAt >= CHECK_EVERY_MS
}

export interface OtaStorage { get(key: string): string | null, set(key: string, value: string): void }

export type OtaOutcome =
  | 'gate-closed' | 'busy' | 'throttled' | 'up-to-date' | 'bad-response' | 'failed-before'
  | 'download-failed' | 'error' | 'staged' | `refused:${OtaVerdict}`

type Plugin = Pick<CapacitorUpdaterPlugin,
  'getLatest' | 'download' | 'next' | 'set' | 'list' | 'delete' | 'current' | 'getNextBundle' | 'getFailedUpdate'>

export function createOtaUpdater({ plugin, kind, updateUrl, shell, busy, storage, now = () => Date.now() }: {
  plugin: Plugin
  kind: AppKind
  // Adresse `updateUrl` des coques, lue au build (voir akaikyUpdateUrl).
  updateUrl: unknown
  shell: () => Promise<Shell>
  // App enfant : appel ou SOS en cours (illisible : occupé). Ignoré pour l'app parent.
  busy: () => Promise<boolean>
  storage: OtaStorage
  now?: () => number
}) {
  const server = akaikyUpdateUrl(updateUrl)
  const child = kind === 'enfant'
  let running = false

  const failed = (): string[] => {
    try {
      const v: unknown = JSON.parse(storage.get(FAILED_KEY) ?? '[]')
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    } catch { return [] }
  }
  const rememberFailed = (versions: string[]) => {
    const all = [...new Set([...failed(), ...versions])].slice(-20)
    try { storage.set(FAILED_KEY, JSON.stringify(all)) } catch { /* stockage indisponible */ }
  }
  // Bundle annulé par le greffon (notifyAppReady absent) : sa version n'est plus jamais reprise,
  // même après que le greffon a effacé le bundle (autoDeleteFailed). Seule source : getFailedUpdate
  // (rendu une fois, puis oublié par le greffon). Un bundle « error » de la liste n'en est pas une :
  // le greffon y laisse aussi un téléchargement raté (réseau, disque, empreinte), qui doit pouvoir
  // être retenté à la vérification suivante ; il est simplement effacé (cleanup).
  async function collectFailures() {
    const last = await plugin.getFailedUpdate().catch(() => null)
    if (typeof last?.bundle?.version === 'string' && last.bundle.version) rememberFailed([last.bundle.version])
  }
  const idle = async () => !child || !(await busy().catch(() => true))
  // Bundle enfant téléchargé, en attente d'installation : le plus récent des bundles « pending ».
  const childStaged = (bundles: BundleInfo[], currentId: string) => bundles
    .filter((b) => b.status === 'pending' && b.id !== currentId && !failed().includes(b.version))
    .sort((a, b) => String(b.downloaded).localeCompare(String(a.downloaded)))[0]

  // Tout bundle téléchargé qui n'est ni l'actuel, ni celui qui attend d'être installé, est effacé
  // (versions dépassées, échecs) ; le greffon efface déjà le précédent après un succès.
  async function cleanup(bundles: BundleInfo[], keep: Set<string>) {
    for (const b of bundles) {
      if (keep.has(b.id) || b.id === 'builtin' || b.status === 'downloading' || b.status === 'deleting' || b.status === 'deleted') continue
      await plugin.delete({ id: b.id }).catch(() => {})
    }
  }

  async function staged(currentId: string, bundles: BundleInfo[]): Promise<string | undefined> {
    if (child) return childStaged(bundles, currentId)?.id
    const next = await plugin.getNextBundle().catch(() => null)
    return next && next.status !== 'error' ? next.id : undefined
  }

  async function check(): Promise<OtaOutcome> {
    if (!server) return 'gate-closed'
    if (running) return 'busy'
    running = true
    try {
      if (!(await idle())) return 'busy'
      const last = Number(storage.get(LAST_CHECK_KEY) ?? NaN)
      if (!dueForCheck(Number.isFinite(last) ? last : null, now())) return 'throttled'
      try { storage.set(LAST_CHECK_KEY, String(now())) } catch { /* stockage indisponible */ }

      await collectFailures()
      const { bundles } = await plugin.list()
      const current = (await plugin.current()).bundle
      // Réponse « pas de mise à jour » : le greffon la rejette ou la rend sans `url`.
      const latest = await plugin.getLatest().catch(() => null)
      if (!latest?.url) {
        await cleanup(bundles, new Set([current.id, (await staged(current.id, bundles)) ?? '']))
        return 'up-to-date'
      }
      const verdict = otaVerdict(targetFromLatest(latest), await shell())
      if (verdict !== 'accept') return `refused:${verdict}`
      const { version, checksum, url } = latest
      let bundleUrl: URL | null = null
      try { bundleUrl = new URL(url) } catch { /* adresse illisible */ }
      // Le zip vient du même serveur que la réponse, et son SHA-256 est vérifié par le greffon.
      if (!VERSION_RE.test(version) || typeof checksum !== 'string' || !CHECKSUM_RE.test(checksum)
        || !bundleUrl || bundleUrl.origin !== server.origin || !bundleUrl.pathname.startsWith('/api/ota/bundles/')) return 'bad-response'
      if (version === current.version) return 'up-to-date'
      if (failed().includes(version)) return 'failed-before'

      // Enfant : seul un bundle « pending » est repris, le seul qu'applyStaged installe.
      let bundle = bundles.find((b) => b.version === version && b.id !== current.id && (b.status === 'pending' || (!child && b.status === 'success')))
      if (!bundle) {
        if (!(await idle())) return 'busy'
        // `checksum` passé explicitement : le greffon refuse un téléchargement sans empreinte, et
        // efface le fichier s'il ne correspond pas (Android finishDownload, iOS
        // resolveExpectedBundleChecksum) ; rien n'est alors installé.
        bundle = await withTimeout(plugin.download({ url, version, checksum }), DOWNLOAD_TIMEOUT_MS).catch(() => undefined)
        if (!bundle || bundle.status === 'error') return 'download-failed'
      }
      if (!child) await plugin.next({ id: bundle.id })
      const after = (await plugin.list()).bundles
      await cleanup(after, new Set([current.id, bundle.id]))
      return 'staged'
    } catch {
      return 'error'
    } finally {
      running = false
    }
  }

  // App enfant : installe le bundle en attente, seulement au repos (aucun appel, aucun SOS) et
  // toujours hors de la vue de l'enfant (`away`, relu juste avant set(), après tous les appels au
  // greffon). Jamais en même temps qu'une vérification.
  async function applyStaged(away: () => Promise<boolean>): Promise<boolean> {
    if (!server || !child || running) return false
    running = true
    try {
      if (!(await idle())) return false
      await collectFailures()
      const current = (await plugin.current()).bundle
      const { bundles } = await plugin.list()
      const id = childStaged(bundles, current.id)?.id
      if (!id || !(await idle()) || !(await away().catch(() => false))) return false
      await plugin.set({ id })
      return true
    } catch {
      return false
    } finally {
      running = false
    }
  }

  return { check, applyStaged }
}
