import { describe, expect, it } from 'vitest'
import { createUnlockGuard, delayAfter, GUARD_KEY } from './unlockGuard'

function memoryStore() {
  const data = new Map<string, string>()
  return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
}

describe('unlockGuard', () => {
  it('cinq essais libres, puis 30 s, 1 min, 2 min… jusqu’à 1 h', () => {
    expect([1, 2, 3, 4].map(delayAfter)).toEqual([0, 0, 0, 0])
    expect([5, 6, 7, 8].map(delayAfter)).toEqual([30_000, 60_000, 120_000, 240_000])
    expect(delayAfter(30)).toBe(3_600_000)
  })

  it('le délai court entre deux essais et survit à une nouvelle instance (redémarrage)', async () => {
    const store = memoryStore()
    let t = 1_000_000
    const guard = createUnlockGuard({ store, now: () => t })
    for (let i = 0; i < 4; i++) expect(await guard.fail()).toBe(0)
    expect(await guard.waitMs()).toBe(0)
    expect(await guard.fail()).toBe(30_000)
    t += 10_000
    const restarted = createUnlockGuard({ store, now: () => t })
    expect(await restarted.waitMs()).toBe(20_000)
    t += 20_000
    expect(await restarted.waitMs()).toBe(0)
    expect(await restarted.fail()).toBe(60_000)
  })

  it('le bon code remet tout à zéro', async () => {
    const store = memoryStore()
    const guard = createUnlockGuard({ store, now: () => 0 })
    for (let i = 0; i < 6; i++) await guard.fail()
    await guard.succeed()
    expect(store.data.has(GUARD_KEY)).toBe(false)
    expect(await guard.fail()).toBe(0)
  })

  it('compteur abîmé : premier délai, réécrit sain, puis il expire', async () => {
    const store = memoryStore()
    store.data.set(GUARD_KEY, '{"failures":"beaucoup"}')
    let t = 0
    const guard = createUnlockGuard({ store, now: () => t })
    expect(await guard.waitMs()).toBe(30_000)
    t += 30_000
    expect(await guard.waitMs()).toBe(0)
    expect(await guard.fail()).toBe(60_000)
  })

  it('Keystore illisible : aucun blocage', async () => {
    const store = { ...memoryStore(), get: async () => { throw new Error('keystore') } }
    expect(await createUnlockGuard({ store, now: () => 0 }).waitMs()).toBe(0)
  })

  it('attente jamais plus longue que le maximum', async () => {
    const store = memoryStore()
    store.data.set(GUARD_KEY, JSON.stringify({ failures: 9, blockedUntil: 10 ** 13 }))
    expect(await createUnlockGuard({ store, now: () => 0 }).waitMs()).toBe(3_600_000)
  })
})
