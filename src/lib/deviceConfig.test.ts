import { describe, expect, it, vi } from 'vitest'
import { createConfigSync, CONFIG_KEY } from './deviceConfig'
import type { DeviceSession } from './deviceSession'

function memoryStore() {
  const data = new Map<string, string>()
  return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
}
const MAMAN = { id: 'c1', name: 'Maman', phone: '+261341234567', position: 1, avatarColor: 'orange' }
const PAPA = { ...MAMAN, id: 'c2', name: 'Papa', position: 2 }
const cache = (childId: string, etag: string, contacts = [MAMAN]) => JSON.stringify({ childId, etag, config: { version: 3, contacts } })
const session = (getIfChanged: unknown) => ({ getIfChanged } as unknown as DeviceSession)

describe('createConfigSync', () => {
  it('premier relevé : gardé dans le stockage sécurisé, lié à l’enfant, avec son ETag', async () => {
    const store = memoryStore()
    const getIfChanged = vi.fn(async () => ({ data: { version: 3, contacts: [MAMAN] }, etag: '"fy.3"' }))
    const sync = createConfigSync({ session: session(getIfChanged), store })
    expect(await sync.load('fy')).toBeNull()
    expect(await sync.refresh()).toEqual({ version: 3, contacts: [MAMAN] })
    expect(getIfChanged).toHaveBeenCalledWith('/device/config', null)
    expect(JSON.parse(store.data.get(CONFIG_KEY)!)).toEqual({ childId: 'fy', etag: '"fy.3"', config: { version: 3, contacts: [MAMAN] } })
  })

  it('relevé suivant : ETag envoyé ; 304 → rien de nouveau ; changement → nouvelle liste', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, cache('fy', '"fy.3"'))
    const getIfChanged = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ data: { version: 4, contacts: [MAMAN, PAPA] }, etag: '"fy.4"' })
    const sync = createConfigSync({ session: session(getIfChanged), store })
    expect((await sync.load('fy'))?.contacts).toEqual([MAMAN])
    expect(await sync.refresh()).toBeNull()
    expect(getIfChanged).toHaveBeenLastCalledWith('/device/config', '"fy.3"')
    expect((await sync.refresh())?.contacts.map((c) => c.name)).toEqual(['Maman', 'Papa'])
    expect(JSON.parse(store.data.get(CONFIG_KEY)!).etag).toBe('"fy.4"')
  })

  it('code parent : gardé avec la config ; une réponse mal formée n’écrase pas le cache valable', async () => {
    const store = memoryStore()
    const hash = 'pbkdf2-sha256$600000$c2Vs$Y2xl'
    const getIfChanged = vi.fn()
      .mockResolvedValueOnce({ data: { version: 4, parentCode: hash, contacts: [MAMAN] }, etag: '"fy.4"' })
      .mockResolvedValueOnce({ data: { version: 5, parentCode: 42, contacts: [] }, etag: '"fy.5"' })
    const sync = createConfigSync({ session: session(getIfChanged), store })
    await sync.load('fy')
    expect((await sync.refresh())?.parentCode).toBe(hash)
    await expect(sync.refresh()).rejects.toThrow()
    expect(JSON.parse(store.data.get(CONFIG_KEY)!).config).toEqual({ version: 4, parentCode: hash, contacts: [MAMAN] })
    expect((await createConfigSync({ session: session(vi.fn()), store }).load('fy'))?.parentCode).toBe(hash)
  })

  it('cache d’un autre enfant (téléphone réappairé) : ignoré', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, cache('ancien', '"ancien.3"'))
    const getIfChanged = vi.fn(async () => null)
    const sync = createConfigSync({ session: session(getIfChanged), store })
    expect(await sync.load('fy')).toBeNull()
    await sync.refresh()
    expect(getIfChanged).toHaveBeenCalledWith('/device/config', null)
  })

  it('hors ligne : erreur remontée, la dernière liste reste en cache', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, cache('fy', '"fy.3"'))
    const sync = createConfigSync({ session: session(async () => { throw new TypeError('Failed to fetch') }), store })
    await sync.load('fy')
    await expect(sync.refresh()).rejects.toBeInstanceOf(TypeError)
    expect((await sync.load('fy'))?.contacts).toEqual([MAMAN])
  })

  it('clear() pendant un relevé : rien n’est réécrit après l’effacement', async () => {
    const store = memoryStore()
    let release: (v: unknown) => void = () => {}
    const sync = createConfigSync({ session: session(() => new Promise((r) => { release = r })), store })
    await sync.load('fy')
    const pending = sync.refresh()
    await sync.clear()
    release({ data: { version: 5, contacts: [MAMAN] }, etag: '"fy.5"' })
    expect(await pending).toBeNull()
    expect(store.data.has(CONFIG_KEY)).toBe(false)
  })

  it('écriture du cache en échec : liste rendue, ETag non avancé (redemandée au relevé suivant)', async () => {
    const store = memoryStore()
    const getIfChanged = vi.fn(async () => ({ data: { version: 4, contacts: [MAMAN] }, etag: '"fy.4"' }))
    const sync = createConfigSync({ session: session(getIfChanged), store: { ...store, set: async () => { throw new Error('keystore') } } })
    await sync.load('fy')
    expect((await sync.refresh())?.contacts).toEqual([MAMAN])
    await sync.refresh()
    expect(getIfChanged).toHaveBeenLastCalledWith('/device/config', null)
  })

  it('cache abîmé ou d’une autre forme : ignoré', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, '{"childId":"fy","config":{"version":"x"}}')
    expect(await createConfigSync({ session: {} as DeviceSession, store }).load('fy')).toBeNull()
    store.data.set(CONFIG_KEY, 'pas du json')
    expect(await createConfigSync({ session: {} as DeviceSession, store }).load('fy')).toBeNull()
  })

  it('plages (NAR-148) : une plage abîmée est écartée seule, contacts et fuseau inconnu gardés', async () => {
    const store = memoryStore()
    const good = { label: 'École', days: 31, startMin: 480, endMin: 960 }
    const getIfChanged = vi.fn(async () => ({ data: { version: 5, timezone: 'Inconnu/Zone', schedules: [good, { label: null, days: 31, startMin: 0, endMin: 60 }, { label: 'X', days: 0, startMin: 0, endMin: 60 }], contacts: [MAMAN] }, etag: '"fy.5"' }))
    const sync = createConfigSync({ session: session(getIfChanged), store })
    await sync.load('fy')
    const config = await sync.refresh()
    expect(config?.schedules).toEqual([good])
    expect(config?.contacts).toEqual([MAMAN])
    expect(config?.timezone).toBe('Inconnu/Zone')
    expect(JSON.parse(store.data.get(CONFIG_KEY)!).config.schedules).toEqual([good])
  })
})
