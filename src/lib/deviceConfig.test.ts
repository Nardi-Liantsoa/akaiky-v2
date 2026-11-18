import { describe, expect, it, vi } from 'vitest'
import { createConfigSync, CONFIG_KEY } from './deviceConfig'
import { DeviceError, type DeviceSession } from './deviceSession'

function memoryStore() {
  const data = new Map<string, string>()
  return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
}
const MAMAN = { id: 'c1', name: 'Maman', phone: '+261341234567', position: 1, avatarColor: 'orange' }
const PAPA = { ...MAMAN, id: 'c2', name: 'Papa', position: 2 }

describe('createConfigSync', () => {
  it('premier relevé : configuration gardée dans le stockage sécurisé avec son ETag', async () => {
    const store = memoryStore()
    const getIfChanged = vi.fn(async () => ({ data: { version: 3, contacts: [MAMAN] }, etag: '"v3"' }))
    const sync = createConfigSync({ session: { getIfChanged } as unknown as DeviceSession, store })
    expect(await sync.load()).toBeNull()
    expect(await sync.refresh()).toEqual({ version: 3, contacts: [MAMAN] })
    expect(getIfChanged).toHaveBeenCalledWith('/device/config', null)
    expect(JSON.parse(store.data.get(CONFIG_KEY)!)).toEqual({ etag: '"v3"', config: { version: 3, contacts: [MAMAN] } })
  })

  it('relevé suivant : ETag envoyé ; 304 → rien de nouveau ; changement → nouvelle liste', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, JSON.stringify({ etag: '"v3"', config: { version: 3, contacts: [MAMAN] } }))
    const getIfChanged = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ data: { version: 4, contacts: [MAMAN, PAPA] }, etag: '"v4"' })
    const sync = createConfigSync({ session: { getIfChanged } as unknown as DeviceSession, store })
    expect((await sync.load())?.contacts).toEqual([MAMAN])
    expect(await sync.refresh()).toBeNull()
    expect(getIfChanged).toHaveBeenLastCalledWith('/device/config', '"v3"')
    expect((await sync.refresh())?.contacts.map((c) => c.name)).toEqual(['Maman', 'Papa'])
    expect(getIfChanged).toHaveBeenLastCalledWith('/device/config', '"v3"')
    expect(JSON.parse(store.data.get(CONFIG_KEY)!).etag).toBe('"v4"')
  })

  it('hors ligne : erreur remontée, la dernière liste reste en cache', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, JSON.stringify({ etag: '"v3"', config: { version: 3, contacts: [MAMAN] } }))
    const sync = createConfigSync({ session: { getIfChanged: async () => { throw new TypeError('Failed to fetch') } } as unknown as DeviceSession, store })
    await sync.load()
    await expect(sync.refresh()).rejects.toBeInstanceOf(TypeError)
    expect(store.data.has(CONFIG_KEY)).toBe(true)
    expect((await sync.load())?.contacts).toEqual([MAMAN])
  })

  it('téléphone retiré (401) : cache effacé, plus aucun contact gardé', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, JSON.stringify({ etag: '"v3"', config: { version: 3, contacts: [MAMAN] } }))
    const sync = createConfigSync({ session: { getIfChanged: async () => { throw new DeviceError(401, 'device_session_lost') } } as unknown as DeviceSession, store })
    await sync.load()
    await expect(sync.refresh()).rejects.toMatchObject({ status: 401 })
    expect(store.data.has(CONFIG_KEY)).toBe(false)
  })

  it('écriture du cache en échec : liste affichée, ETag non avancé (redemandée au relevé suivant)', async () => {
    const store = memoryStore()
    const getIfChanged = vi.fn(async () => ({ data: { version: 4, contacts: [MAMAN] }, etag: '"c.4"' }))
    const sync = createConfigSync({ session: { getIfChanged } as unknown as DeviceSession, store: { ...store, set: async () => { throw new Error('keystore') } } })
    expect((await sync.refresh())?.contacts).toEqual([MAMAN])
    await sync.refresh()
    expect(getIfChanged).toHaveBeenLastCalledWith('/device/config', null)
  })

  it('cache abîmé ou d’une autre forme : ignoré', async () => {
    const store = memoryStore()
    store.data.set(CONFIG_KEY, '{"config":{"version":"x"}}')
    expect(await createConfigSync({ session: {} as DeviceSession, store }).load()).toBeNull()
    store.data.set(CONFIG_KEY, 'pas du json')
    expect(await createConfigSync({ session: {} as DeviceSession, store }).load()).toBeNull()
  })
})
