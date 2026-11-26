// Session du téléphone de l'enfant (NAR-164), sur le modèle de transport-native.ts
// mais pour un appareil : routes /api/device/*, clé de stockage distincte.
//   - jeton d'accès court, en mémoire seulement ;
//   - jeton de renouvellement dans le Keystore (stockage sécurisé), jamais dans
//     localStorage ni Preferences ;
//   - renouvellements sérialisés : le serveur tourne le jeton à chaque usage et
//     ferme la session si un ancien est présenté deux fois. Sérialisés dans l'écran (une
//     promesse partagée) ET entre écrans (NAR-245) : verrou Web Locks commun à toutes les
//     WebViews de l'app, le jeton relu dans le Keystore une fois le verrou obtenu. Un écran
//     qui y trouve un jeton tourné par un autre reprend son résultat (jeton d'accès gardé à
//     côté dans le Keystore) au lieu de tourner encore : le serveur ne garde qu'un jeton
//     d'accès par session, deux rotations s'invalideraient l'une l'autre.
// Une erreur réseau n'est jamais une perte de session : seul un 401 l'est.

export interface SecretStore {
  get(key: string): Promise<unknown>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface DeviceInfoBody { model?: string, osVersion?: string, appVersion?: string }
export interface PairResult { device: { id: string }, child: { id: string } }
export interface DeviceMe { device: { id: string }, child: { id: string, firstName: string } }

// Refus définitif de l'appairage ou de la session : code serveur conservé.
export class DeviceError extends Error {
  constructor(readonly status: number, readonly code: string | null) { super(code ?? `HTTP ${status}`) }
}

export const REFRESH_KEY = 'device-refresh-token'
export const ACCESS_KEY = 'device-access-token'
const REFRESH_LOCK = 'akaiky-device-refresh'
// Un renouvellement bloqué (réseau à moitié ouvert) ne garde jamais le verrou des autres écrans.
export const REFRESH_TIMEOUT_MS = 20_000

// Verrou entre écrans : navigator.locks (Chrome 69+), sinon aucun (WebView plus ancienne : la
// sérialisation dans l'écran reste).
export interface RefreshLocks { request<T>(name: string, callback: () => Promise<T>): Promise<T> }
function defaultLocks(): RefreshLocks | null {
  const locks = (globalThis.navigator as { locks?: { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> } } | undefined)?.locks
  return locks ? { request: <T>(name: string, cb: () => Promise<T>) => locks.request(name, cb) as Promise<T> } : null
}

// `onReset` : efface les données liées à la session (configuration de l'enfant) quand
// elle est perdue ou remplacée par un nouvel appairage : jamais les contacts d'un
// autre enfant affichés, ni gardés sur un téléphone retiré.
export function createDeviceSession({ base, store, fetch: doFetch, onReset, locks = defaultLocks() }: { base: string, store: SecretStore, fetch: typeof fetch, onReset?: () => Promise<void>, locks?: RefreshLocks | null }) {
  let access: string | null = null
  // Jeton de renouvellement que cet écran sait courant : un autre dans le Keystore = un autre
  // écran l'a tourné entre-temps.
  let known: string | null = null
  let refreshing: Promise<boolean> | null = null
  const exclusive = <T>(run: () => Promise<T>): Promise<T> => (locks ? locks.request(REFRESH_LOCK, run) : run())

  // Un échec d'écriture dans le Keystore après un appairage réussi ne doit pas jeter
  // une session que le serveur vient d'ouvrir (le jeton d'appairage est consommé) :
  // seconde tentative, puis session gardée en mémoire pour ce lancement.
  async function keep(t: { accessToken: string, refreshToken: string }) {
    access = t.accessToken
    known = t.refreshToken
    await store.set(REFRESH_KEY, t.refreshToken)
      .catch(() => store.set(REFRESH_KEY, t.refreshToken))
      .catch(() => {})
    // Pour les autres écrans de l'app : ils reprennent ce jeton au lieu de tourner de nouveau.
    await store.set(ACCESS_KEY, t.accessToken).catch(() => {})
  }
  async function forget() {
    access = null
    known = null
    await store.remove(REFRESH_KEY).catch(() => {})
    await store.remove(ACCESS_KEY).catch(() => {})
    await clearData()
  }
  async function clearData() {
    await onReset?.().catch(() => {})
  }
  const post = (path: string, body: unknown) => doFetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit'
  })
  async function failure(res: Response): Promise<DeviceError> {
    const body = await res.json().catch(() => null) as { code?: string } | null
    return new DeviceError(res.status, body?.code ?? null)
  }

  // Faux : aucune session, ou le serveur la refuse (401, effacée). Lève une erreur
  // si le réseau ou le serveur est indisponible : la session est alors gardée.
  async function rotate(): Promise<boolean> {
    // Relu sous le verrou : un autre écran a pu tourner le jeton pendant l'attente.
    const saved = await store.get(REFRESH_KEY)
    if (typeof saved !== 'string' || !saved) return false
    if (saved !== known) {
      // Tourné par un autre écran (ou premier passage) : son jeton d'accès est repris. S'il est
      // déjà périmé, le 401 suivant ramène ici avec known = saved, et la rotation a lieu.
      const shared = await store.get(ACCESS_KEY).catch(() => null)
      known = saved
      if (typeof shared === 'string' && shared && shared !== access) { access = shared; return true }
    }
    const res = await Promise.race([
      post('/device/refresh', { refreshToken: saved }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('refresh_timeout')), REFRESH_TIMEOUT_MS))
    ])
    if (res.status === 401) { await forget(); return false }
    if (!res.ok) throw await failure(res)
    // Nouveau jeton écrit avant de rendre le verrou : l'écran suivant le lit.
    await keep(await res.json())
    return true
  }
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        return await exclusive(rotate)
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  }

  async function authorized(path: string, extra: Record<string, string>, init: RequestInit = {}): Promise<Response> {
    const call = () => doFetch(`${base}${path}`, { ...init, headers: { ...extra, ...(access ? { Authorization: `Bearer ${access}` } : {}) }, credentials: 'omit' })
    let res = access ? await call() : null
    // Deux essais : un autre écran a pu tourner (et invalider ce jeton d'accès) juste après
    // notre renouvellement ; le second reprend son résultat. Toujours refusé : session perdue.
    for (let attempt = 0; attempt < 2 && (!res || res.status === 401); attempt++) {
      if (!(await refresh())) throw new DeviceError(401, 'device_session_lost')
      res = await call()
    }
    if (!res || res.status === 401) { await forget(); throw new DeviceError(401, 'device_session_lost') }
    return res
  }

  return {
    async hasSession(): Promise<boolean> {
      const saved = await store.get(REFRESH_KEY)
      return typeof saved === 'string' && saved.length > 0
    },

    // Échange du jeton d'appairage. Une session déjà présente est remplacée.
    async pair(token: string, info: DeviceInfoBody): Promise<PairResult> {
      const body: Record<string, string> = { token }
      for (const k of ['model', 'osVersion', 'appVersion'] as const) if (info[k]) body[k] = info[k]!.slice(0, 200)
      const res = await post('/device/pair', body)
      if (!res.ok) throw await failure(res)
      const json = await res.json()
      // Sous le verrou : un renouvellement d'un autre écran n'écrase jamais la nouvelle session.
      await exclusive(async () => { await clearData(); await keep(json) })
      return { device: json.device, child: json.child }
    },

    // GET authentifié ; un 401 déclenche un renouvellement puis un nouvel essai.
    // Session refusée par le serveur → DeviceError 401 (session effacée).
    async get<T>(path: string): Promise<T> {
      const res = await authorized(path, {})
      if (!res.ok) throw await failure(res)
      return res.json() as Promise<T>
    },

    // POST authentifié (journal du téléphone).
    async post<T>(path: string, body: unknown): Promise<T> {
      const res = await authorized(path, { 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok) throw await failure(res)
      return res.json() as Promise<T>
    },

    // PUT authentifié (inventaire des applications, NAR-143).
    async put<T>(path: string, body: unknown): Promise<T> {
      const res = await authorized(path, { 'Content-Type': 'application/json' }, { method: 'PUT', body: JSON.stringify(body) })
      if (!res.ok) throw await failure(res)
      return res.json() as Promise<T>
    },

    // GET conditionnel (ETag) : `null` si rien n'a changé depuis `etag` (304).
    async getIfChanged<T>(path: string, etag: string | null): Promise<{ data: T, etag: string | null } | null> {
      const res = await authorized(path, etag ? { 'If-None-Match': etag } : {})
      if (res.status === 304) return null
      if (!res.ok) throw await failure(res)
      return { data: await res.json() as T, etag: res.headers.get('ETag') }
    }
  }
}

export type DeviceSession = ReturnType<typeof createDeviceSession>
