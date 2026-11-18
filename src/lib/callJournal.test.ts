import { describe, expect, it, vi } from 'vitest'
import { createCallJournal, PENDING_KEY, QUEUE_KEY, type DeviceEvent, type JournalDeps } from './callJournal'
import { DeviceError } from './deviceSession'

function setup(over: Partial<JournalDeps> = {}) {
  const data = new Map<string, string>()
  const store = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
  let t = 1_000_000, n = 0
  const deps: JournalDeps = {
    store,
    post: vi.fn(async (events: DeviceEvent[]) => ({ accepted: events.map((e) => e.id), rejected: [] })),
    lastOutgoing: vi.fn(async () => ({ found: true, startedAt: 1_000_500, durationS: 42 })),
    now: () => t,
    uuid: () => `id-${++n}`,
    ...over
  }
  const queue = () => JSON.parse(data.get(QUEUE_KEY) ?? '[]')
  const pending = () => JSON.parse(data.get(PENDING_KEY) ?? '[]')
  return { journal: createCallJournal(deps), deps, data, queue, pending, advance: (ms: number) => { t += ms } }
}

describe('createCallJournal', () => {
  it('déverrouillage (NAR-168) : mis dans la file avec son origine et sa durée, envoyé avec les appels', async () => {
    const s = setup()
    await s.journal.unlocked('remote', 12)
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await s.journal.complete()
    expect(s.queue().map((e: DeviceEvent) => e.kind)).toEqual(['unlock', 'call_out'])
    expect(s.queue()[0]).toEqual({ id: 'id-1', kind: 'unlock', source: 'remote', startedAt: new Date(1_000_000).toISOString(), durationS: 720 })
    await s.journal.flush()
    expect(s.queue()).toEqual([])
  })

  it('appel → durée lue au retour → envoyé ; file et appels en cours vidés', async () => {
    const s = setup()
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    expect(s.pending()).toHaveLength(1)
    await s.journal.complete()
    expect(s.deps.lastOutgoing).toHaveBeenCalledWith('+261341234567', 1_000_000 - 2_000, undefined)
    expect(s.queue()).toEqual([{ id: 'id-1', kind: 'call_out', contactId: 'maman', name: 'Maman', phone: '+261341234567', startedAt: new Date(1_000_500).toISOString(), durationS: 42 }])
    await s.journal.flush()
    expect(s.deps.post).toHaveBeenCalledTimes(1)
    expect(s.queue()).toEqual([])
    expect(s.pending()).toEqual([])
  })

  it('hors ligne : la file reste, puis part au relevé suivant (même identifiant)', async () => {
    const post = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async (events) => ({ accepted: events.map((e: { id: string }) => e.id), rejected: [] }))
    const s = setup({ post })
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await s.journal.complete()
    await s.journal.flush()
    expect(s.queue()).toHaveLength(1)
    await s.journal.flush()
    expect(post.mock.calls[0][0][0].id).toBe(post.mock.calls[1][0][0].id)
    expect(s.queue()).toEqual([])
  })

  it('appel absent du journal d’Android : attend, puis part sans durée après une heure', async () => {
    const s = setup({ lastOutgoing: vi.fn(async () => ({ found: false })) })
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await s.journal.complete()
    expect(s.pending()).toHaveLength(1)
    s.advance(61 * 60_000)
    await s.journal.complete()
    expect(s.queue()[0].durationS).toBeNull()
    expect(s.pending()).toEqual([])
  })

  it('événement refusé par le serveur : retiré (ne bloque pas la file) ; 401 : file vidée', async () => {
    const s = setup({ post: vi.fn(async (events: DeviceEvent[]) => ({ accepted: [] as string[], rejected: events.map((e) => e.id) })) })
    await s.journal.started({ id: 'autre', name: 'Autre' }, '+261320000000')
    await s.journal.complete()
    await s.journal.flush()
    expect(s.queue()).toEqual([])
    const lost = setup({ post: vi.fn(async () => { throw new DeviceError(401, 'device_session_lost') }) })
    await lost.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await lost.journal.complete()
    await lost.journal.flush()
    expect(lost.queue()).toEqual([])
  })

  it('opérations simultanées sérialisées : aucun appel perdu', async () => {
    const s = setup()
    await Promise.all([s.journal.started({ id: 'a', name: 'A' }, '+1'), s.journal.started({ id: 'b', name: 'B' }, '+2'), s.journal.started({ id: 'c', name: 'C' }, '+3')])
    expect(s.pending().map((p: { contactId: string }) => p.contactId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('deux appels au même numéro : chacun cherche sa durée avant le suivant', async () => {
    const s = setup({ lastOutgoing: vi.fn(async (_n: string, since: number) => ({ found: true, startedAt: since + 10_000, durationS: since > 1_100_000 ? 7 : 3 })) })
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    s.advance(120_000)
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await s.journal.complete()
    expect(s.deps.lastOutgoing).toHaveBeenNthCalledWith(1, '+261341234567', 998_000, 1_120_000)
    expect(s.deps.lastOutgoing).toHaveBeenNthCalledWith(2, '+261341234567', 1_118_000, undefined)
    expect(s.queue().map((e: { durationS: number }) => e.durationS)).toEqual([3, 7])
  })

  it('appel annulé (non parti) : rien de journalisé ; complete() dit combien attendent', async () => {
    const s = setup({ lastOutgoing: vi.fn(async () => ({ found: false })) })
    const id = await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await s.journal.cancel(id)
    expect(s.pending()).toEqual([])
    await s.journal.started({ id: 'papa', name: 'Papa' }, '+261331234567')
    expect(await s.journal.complete()).toBe(1)
  })

  it('permission du journal d’Android refusée : envoyé tout de suite, sans durée', async () => {
    const s = setup({ lastOutgoing: vi.fn(async () => ({ found: false, permission: false })) })
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    expect(await s.journal.complete()).toBe(0)
    expect(s.queue()[0].durationS).toBeNull()
  })

  it('un envoi réseau en cours ne retarde pas un appel qui part', async () => {
    let release: () => void = () => {}
    const s = setup({ post: vi.fn(() => new Promise<{ accepted: string[], rejected: string[] }>((r) => { release = () => r({ accepted: [], rejected: [] }) })) })
    await s.journal.started({ id: 'maman', name: 'Maman' }, '+261341234567')
    await s.journal.complete()
    const flushing = s.journal.flush()
    await expect(Promise.race([s.journal.started({ id: 'papa', name: 'Papa' }, '+261331234567'), new Promise((r) => setTimeout(() => r('bloqué'), 50))])).resolves.not.toBe('bloqué')
    release()
    await flushing
  })
})
