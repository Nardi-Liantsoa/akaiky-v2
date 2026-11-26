import { describe, expect, it, vi } from 'vitest'
import { createDeviceSession, DeviceError, REFRESH_KEY } from './deviceSession'

// Frontières simulées : stockage sécurisé (Keystore) et réseau.
function memoryStore() {
  const data = new Map<string, string>()
  return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const TOKENS = { accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 }

describe('createDeviceSession', () => {
  it('appairage : jeton de renouvellement dans le stockage sécurisé, jamais dans localStorage', async () => {
    const store = memoryStore()
    const fetch = vi.fn(async () => json(201, { ...TOKENS, device: { id: 'd' }, child: { id: 'c' } }))
    const s = createDeviceSession({ base: 'https://api.test/api', store, fetch })
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem, getItem: vi.fn(), removeItem: vi.fn() })
    expect(await s.pair('t'.repeat(43), { model: 'Pixel', osVersion: '14' })).toEqual({ device: { id: 'd' }, child: { id: 'c' } })
    expect(store.data.get(REFRESH_KEY)).toBe('r1')
    expect(setItem).not.toHaveBeenCalled()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/api/device/pair')
    expect(JSON.parse(init.body as string)).toEqual({ token: 't'.repeat(43), model: 'Pixel', osVersion: '14' })
    expect(init.credentials).toBe('omit')
    vi.unstubAllGlobals()
  })

  it('Keystore en panne après l’appairage : session gardée en mémoire pour ce lancement', async () => {
    const store = memoryStore()
    const broken = { ...store, set: async () => { throw new Error('keystore') } }
    const fetch = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/device/pair')
      ? json(201, { ...TOKENS, device: { id: 'd' }, child: { id: 'c' } })
      : (new Headers(init?.headers).get('Authorization') === 'Bearer a1' ? json(200, { ok: 1 }) : json(401, {})))
    const s = createDeviceSession({ base: '', store: broken, fetch: fetch as unknown as typeof globalThis.fetch })
    await s.pair('x', {})
    expect(await s.get('/device/me')).toEqual({ ok: 1 })
  })

  it('écriture du Keystore en échec une fois : seconde tentative, session gardée', async () => {
    const store = memoryStore()
    let fails = 1
    const flaky = { ...store, set: async (k: string, v: string) => { if (fails-- > 0) throw new Error('keystore'); await store.set(k, v) } }
    const s = createDeviceSession({ base: '', store: flaky, fetch: async () => json(201, { ...TOKENS, device: { id: 'd' }, child: { id: 'c' } }) })
    await s.pair('x', {})
    expect(store.data.get(REFRESH_KEY)).toBe('r1')
  })

  it('données liées effacées : au nouvel appairage et à la perte de session', async () => {
    const store = memoryStore()
    const onReset = vi.fn(async () => {})
    const ok = createDeviceSession({ base: '', store, onReset, fetch: async () => json(201, { ...TOKENS, device: { id: 'd' }, child: { id: 'c' } }) })
    await ok.pair('x', {})
    expect(onReset).toHaveBeenCalledTimes(1)
    const lost = createDeviceSession({ base: '', store, onReset, fetch: async () => json(401, {}) })
    await expect(lost.get('/device/me')).rejects.toMatchObject({ status: 401 })
    expect(onReset).toHaveBeenCalledTimes(2)
  })

  it('appairage refusé : erreur avec le code du serveur, rien de stocké', async () => {
    const store = memoryStore()
    const s = createDeviceSession({ base: '', store, fetch: async () => json(401, { code: 'pairing_invalid' }) })
    await expect(s.pair('x', {})).rejects.toMatchObject({ status: 401, code: 'pairing_invalid' })
    expect(store.data.size).toBe(0)
  })

  it('GET : jeton d’accès expiré → un seul renouvellement, puis nouvel essai', async () => {
    const store = memoryStore()
    store.data.set(REFRESH_KEY, 'r0')
    const calls: string[] = []
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/device/refresh')) return json(200, TOKENS)
      const auth = new Headers(init?.headers).get('Authorization')
      return auth === 'Bearer a1' ? json(200, { ok: 1 }) : json(401, {})
    })
    const s = createDeviceSession({ base: '', store, fetch: fetch as unknown as typeof globalThis.fetch })
    expect(await Promise.all([s.get('/device/me'), s.get('/device/me')])).toEqual([{ ok: 1 }, { ok: 1 }])
    expect(calls.filter((c) => c.includes('refresh'))).toHaveLength(1)
    expect(store.data.get(REFRESH_KEY)).toBe('r1')
  })

  it('session refusée (401 au renouvellement) : effacée, DeviceError 401', async () => {
    const store = memoryStore()
    store.data.set(REFRESH_KEY, 'r0')
    const s = createDeviceSession({ base: '', store, fetch: async () => json(401, {}) })
    await expect(s.get('/device/me')).rejects.toMatchObject({ status: 401, code: 'device_session_lost' })
    expect(store.data.has(REFRESH_KEY)).toBe(false)
  })

  it('réseau ou serveur indisponible : la session est gardée', async () => {
    const store = memoryStore()
    store.data.set(REFRESH_KEY, 'r0')
    const down = createDeviceSession({ base: '', store, fetch: async () => { throw new TypeError('Failed to fetch') } })
    await expect(down.get('/device/me')).rejects.toBeInstanceOf(TypeError)
    const busy = createDeviceSession({ base: '', store, fetch: async () => json(503, {}) })
    await expect(busy.get('/device/me')).rejects.toBeInstanceOf(DeviceError)
    expect(store.data.get(REFRESH_KEY)).toBe('r0')
  })

  // NAR-245 : deux écrans (deux WebViews, même Keystore) renouvellent en même temps. Sans verrou
  // commun, les deux présentent le même jeton : le serveur voit deux détenteurs et ferme la session.
  // Avec le verrou (Web Locks, partagé par les WebViews de l'app), le second relit le jeton tourné.
  it('deux écrans en même temps : jamais deux renouvellements avec le même jeton', async () => {
    const store = memoryStore()
    store.data.set(REFRESH_KEY, 'r0')
    // Serveur qui tourne le jeton : un jeton déjà tourné présenté de nouveau = rejeu.
    let current = 'r0', n = 0
    const presented: string[] = []
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/device/refresh')) {
        const { refreshToken } = JSON.parse(init!.body as string)
        presented.push(refreshToken)
        await new Promise((r) => setTimeout(r, 5))
        if (refreshToken !== current) return json(401, {})
        current = `r${++n}`
        return json(200, { accessToken: `a${n}`, refreshToken: current, expiresIn: 900 })
      }
      // Comme le serveur : un seul jeton d'accès valable par session, le dernier émis.
      return new Headers(init?.headers).get('Authorization') === `Bearer a${n}` ? json(200, { ok: 1 }) : json(401, {})
    })
    // Verrou partagé des deux écrans (navigator.locks dans les WebViews).
    let chain = Promise.resolve()
    const locks = { request: <T>(_name: string, cb: () => Promise<T>) => { const run = chain.then(cb); chain = run.then(() => {}, () => {}); return run } }
    const a = createDeviceSession({ base: '', store, fetch: fetch as unknown as typeof globalThis.fetch, locks })
    const b = createDeviceSession({ base: '', store, fetch: fetch as unknown as typeof globalThis.fetch, locks })
    const [ra, rb] = await Promise.all([a.get('/device/me'), b.get('/device/me')])
    expect(ra).toEqual({ ok: 1 })
    expect(rb).toEqual({ ok: 1 })
    expect(new Set(presented).size).toBe(presented.length)
    expect(store.data.get(REFRESH_KEY)).toBe(current)
    // Le second écran reprend la rotation du premier : une seule rotation pour les deux.
    expect(presented).toEqual(['r0'])
    // Et la suite continue sans renouveler à chaque appel (pas de vol mutuel du jeton d'accès).
    await Promise.all([a.get('/device/me'), b.get('/device/me'), a.get('/device/me'), b.get('/device/me')])
    expect(presented).toEqual(['r0'])
  })

  it('renouvellement bloqué : abandonné après le délai, le verrou est rendu, la session gardée', async () => {
    vi.useFakeTimers()
    const store = memoryStore()
    store.data.set(REFRESH_KEY, 'r0')
    const fetch = vi.fn(() => new Promise<Response>(() => {}))
    const s = createDeviceSession({ base: '', store, fetch: fetch as unknown as typeof globalThis.fetch, locks: null })
    const pending = s.get('/device/me').catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_001)
    const err = await pending
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(DeviceError)
    expect(store.data.get(REFRESH_KEY)).toBe('r0')
    vi.useRealTimers()
  })
})
