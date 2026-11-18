// Session du téléphone de l'enfant (NAR-164), sur le modèle de transport-native.ts
// mais pour un appareil : routes /api/device/*, clé de stockage distincte.
//   - jeton d'accès court, en mémoire seulement ;
//   - jeton de renouvellement dans le Keystore (stockage sécurisé), jamais dans
//     localStorage ni Preferences ;
//   - renouvellements sérialisés : le serveur tourne le jeton à chaque usage et
//     ferme la session si un ancien est présenté deux fois.
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

export function createDeviceSession({ base, store, fetch: doFetch }: { base: string, store: SecretStore, fetch: typeof fetch }) {
  let access: string | null = null
  let refreshing: Promise<boolean> | null = null

  // Un échec d'écriture dans le Keystore après un appairage réussi coûterait le jeton
  // (déjà consommé côté serveur) : une seconde tentative avant d'abandonner.
  async function keep(t: { accessToken: string, refreshToken: string }) {
    access = t.accessToken
    await store.set(REFRESH_KEY, t.refreshToken).catch(() => store.set(REFRESH_KEY, t.refreshToken))
  }
  async function forget() {
    access = null
    await store.remove(REFRESH_KEY).catch(() => {})
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
  function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const saved = await store.get(REFRESH_KEY)
        if (typeof saved !== 'string' || !saved) return false
        const res = await post('/device/refresh', { refreshToken: saved })
        if (res.status === 401) { await forget(); return false }
        if (!res.ok) throw await failure(res)
        await keep(await res.json())
        return true
      } finally {
        refreshing = null
      }
    })()
    return refreshing
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
      await keep(json)
      return { device: json.device, child: json.child }
    },

    // GET authentifié ; un 401 déclenche un renouvellement puis un nouvel essai.
    // Session refusée par le serveur → DeviceError 401 (session effacée).
    async get<T>(path: string): Promise<T> {
      const call = () => doFetch(`${base}${path}`, { headers: access ? { Authorization: `Bearer ${access}` } : {}, credentials: 'omit' })
      let res = access ? await call() : null
      if (!res || res.status === 401) {
        if (!(await refresh())) throw new DeviceError(401, 'device_session_lost')
        res = await call()
      }
      if (res.status === 401) { await forget(); throw new DeviceError(401, 'device_session_lost') }
      if (!res.ok) throw await failure(res)
      return res.json() as Promise<T>
    }
  }
}

export type DeviceSession = ReturnType<typeof createDeviceSession>
