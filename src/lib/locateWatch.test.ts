import { describe, expect, it, vi } from 'vitest'
import { createLocateWatch, type LocateStatus } from './locateWatch'

const FIX = { lat: -18.9, lng: 47.5, accuracyM: 12, ageS: 2 }
const until = (ms: number) => new Date(ms).toISOString()

function setup(status: LocateStatus | Error) {
  const get = vi.fn(async () => { if (status instanceof Error) throw status; return status })
  const post = vi.fn(async () => ({ ok: true }))
  const fix = vi.fn(async () => FIX)
  return { get, post, fix, watch: createLocateWatch({ get, post, fix }) }
}

describe('position à la demande (téléphone)', () => {
  it('relevé dû : un relevé unique, envoyé au serveur ; qui regarde, jusqu’à la fin', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000) })
    await t.watch.tick()
    expect(t.fix).toHaveBeenCalledTimes(1)
    expect(t.post).toHaveBeenCalledWith('/device/positions', FIX)
    expect(t.watch.watchers(60_000)).toEqual(['Papa'])
    expect(t.watch.watchers(120_000)).toEqual([])
  })

  it('rien de dû : aucun relevé', async () => {
    const t = setup({ pending: false, watchers: [{ name: 'Maman' }], watchingUntil: until(120_000) })
    await t.watch.tick()
    expect(t.fix).not.toHaveBeenCalled()
    expect(t.post).not.toHaveBeenCalled()
    expect(t.watch.watchers(0)).toEqual(['Maman'])
  })

  it('personne ne regarde : indicateur vide', async () => {
    const t = setup({ pending: false, watchers: [], watchingUntil: null })
    await t.watch.tick()
    expect(t.watch.watchers(0)).toEqual([])
  })

  it('relevé impossible (délai, refus) ou envoi refusé : sans erreur, le tour suivant relit l’état', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000) })
    t.fix.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout' }))
    await expect(t.watch.tick()).resolves.toBeUndefined()
    expect(t.post).not.toHaveBeenCalled()
    t.post.mockRejectedValueOnce(new Error('409'))
    await expect(t.watch.tick()).resolves.toBeUndefined()
    expect(t.post).toHaveBeenCalledTimes(1)
  })

  it('hors ligne : l’indicateur déjà affiché reste jusqu’à la fin de la consultation, puis s’efface', async () => {
    const t = setup({ pending: false, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000) })
    await t.watch.tick()
    t.get.mockRejectedValueOnce(new Error('offline'))
    await t.watch.tick()
    expect(t.watch.watchers(100_000)).toEqual(['Papa'])
    expect(t.watch.watchers(130_000)).toEqual([])
  })

  it('un seul tour à la fois', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000) })
    await Promise.all([t.watch.tick(), t.watch.tick(), t.watch.tick()])
    expect(t.get).toHaveBeenCalledTimes(1)
    expect(t.fix).toHaveBeenCalledTimes(1)
  })

  it('réponse mal formée : ni relevé ni indicateur', async () => {
    const t = setup({ pending: 'oui', watchers: 'Papa', watchingUntil: 'demain' } as unknown as LocateStatus)
    await t.watch.tick()
    expect(t.fix).not.toHaveBeenCalled()
    expect(t.watch.watchers(0)).toEqual([])
  })
})
