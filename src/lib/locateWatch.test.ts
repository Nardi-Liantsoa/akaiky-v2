import { describe, expect, it, vi } from 'vitest'
import { FIX_BACKOFF_TICKS, createLocateWatch, type LocateStatus, type Watching } from './locateWatch'

const FIX = { lat: -18.9, lng: 47.5, accuracyM: 12, ageS: 2 }
const until = (ms: number) => new Date(ms).toISOString()

function setup(status: LocateStatus | Error) {
  const get = vi.fn(async () => { if (status instanceof Error) throw status; return status })
  const post = vi.fn<(path: string, body: unknown) => Promise<unknown>>(async () => ({ ok: true }))
  const fix = vi.fn(async () => FIX)
  const cancelFix = vi.fn(async () => {})
  const seen: (Watching | null)[] = []
  let now = 0
  const watch = createLocateWatch({ get, post, fix, cancelFix, onWatching: (w) => seen.push(w), clock: () => now })
  return { get, post, fix, cancelFix, seen, watch, advance: (ms: number) => { now += ms } }
}

describe('position à la demande (téléphone)', () => {
  it('relevé dû : qui regarde annoncé avant le relevé, puis un relevé unique envoyé', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000), watchingForMs: 120_000 })
    t.fix.mockImplementationOnce(async () => {
      expect(t.seen).toEqual([{ names: ['Papa'], forMs: 120_000 }])
      return FIX
    })
    await t.watch.tick()
    expect(t.fix).toHaveBeenCalledTimes(1)
    expect(t.post).toHaveBeenCalledWith('/device/positions', FIX)
  })

  it('envoi retardé : l’âge du relevé grandit des secondes entières écoulées', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000), watchingForMs: 120_000 })
    // Horloge monotone : 1,2 s entre le relevé rendu et l'envoi.
    let n = 0
    const watch = createLocateWatch({ get: t.get, post: t.post, fix: t.fix, cancelFix: t.cancelFix, onWatching: () => {}, clock: () => (n += 1200) })
    await watch.tick()
    expect(t.post.mock.calls[0][1]).toEqual({ ...FIX, ageS: FIX.ageS + 1 })
  })

  it('rien de dû : aucun relevé, mais l’indicateur', async () => {
    const t = setup({ pending: false, watchers: [{ name: 'Maman' }], watchingUntil: until(120_000), watchingForMs: 120_000 })
    await t.watch.tick()
    expect(t.fix).not.toHaveBeenCalled()
    expect(t.post).not.toHaveBeenCalled()
    expect(t.seen).toEqual([{ names: ['Maman'], forMs: 120_000 }])
  })

  it('personne ne regarde : indicateur vide', async () => {
    const t = setup({ pending: false, watchers: [], watchingUntil: null })
    await t.watch.tick()
    expect(t.seen).toEqual([null])
  })

  it('relevé impossible (délai, refus) ou envoi refusé : sans erreur, le tour suivant relit l’état', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000), watchingForMs: 120_000 })
    t.fix.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout' }))
    await expect(t.watch.tick()).resolves.toBeUndefined()
    expect(t.post).not.toHaveBeenCalled()
    // Le GPS se repose quelques tours (l'indicateur, lui, reste lu), puis un nouveau relevé.
    for (let i = 0; i < FIX_BACKOFF_TICKS; i++) await t.watch.tick()
    expect(t.fix).toHaveBeenCalledTimes(1)
    expect(t.get).toHaveBeenCalledTimes(1 + FIX_BACKOFF_TICKS)
    t.post.mockRejectedValueOnce(new Error('409'))
    await expect(t.watch.tick()).resolves.toBeUndefined()
    expect(t.post).toHaveBeenCalledTimes(1)
  })

  it('hors ligne : rien n’est publié (l’écran garde l’indicateur jusqu’à sa fin)', async () => {
    const t = setup(new Error('offline'))
    await t.watch.tick()
    expect(t.seen).toEqual([])
  })

  it('un seul tour à la fois', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000), watchingForMs: 120_000 })
    await Promise.all([t.watch.tick(), t.watch.tick(), t.watch.tick()])
    expect(t.get).toHaveBeenCalledTimes(1)
    expect(t.fix).toHaveBeenCalledTimes(1)
  })

  it('arrêt pendant le relevé : relevé natif abandonné, rien d’envoyé ni de republié', async () => {
    const t = setup({ pending: true, watchers: [{ name: 'Papa' }], watchingUntil: until(120_000), watchingForMs: 120_000 })
    let release!: () => void
    t.fix.mockImplementationOnce(() => new Promise((r) => { release = () => r(FIX) }))
    const run = t.watch.tick()
    await vi.waitFor(() => expect(t.fix).toHaveBeenCalled())
    t.watch.stop()
    expect(t.cancelFix).toHaveBeenCalledTimes(1)
    release()
    await run
    expect(t.post).not.toHaveBeenCalled()
    expect(t.seen.at(-1)).toBeNull()
  })

  it('arrêt puis reprise : le tour d’avant ne libère pas celui d’après (toujours un seul tour)', async () => {
    const t = setup({ pending: false, watchers: [], watchingUntil: null })
    let releaseFirst!: () => void
    t.get.mockImplementationOnce(() => new Promise((r) => { releaseFirst = () => r({ pending: false, watchers: [], watchingUntil: null }) }))
    let releaseSecond!: () => void
    t.get.mockImplementationOnce(() => new Promise((r) => { releaseSecond = () => r({ pending: false, watchers: [], watchingUntil: null }) }))
    const first = t.watch.tick()
    t.watch.stop()
    const second = t.watch.tick()
    releaseFirst()
    await first
    // Le second tour est toujours en cours : un nouvel appel le rejoint, sans nouvelle lecture.
    const third = t.watch.tick()
    expect(t.get).toHaveBeenCalledTimes(2)
    releaseSecond()
    await Promise.all([second, third])
  })

  it('réponse mal formée : ni relevé ni indicateur', async () => {
    const t = setup({ pending: 'oui', watchers: 'Papa', watchingUntil: 'demain', watchingForMs: 'longtemps' } as unknown as LocateStatus)
    await t.watch.tick()
    expect(t.fix).not.toHaveBeenCalled()
    expect(t.seen).toEqual([null])
  })
})
