import { describe, expect, it, vi } from 'vitest'
import { createMessageOutbox, OUTBOX_KEY } from './messageOutbox'
import { DeviceError } from './deviceSession'

function setup(post = vi.fn(async () => ({}))) {
  const data = new Map<string, string>()
  const store = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
  let n = 0
  const outbox = createMessageOutbox({ store, post, uuid: () => `m-${++n}`, now: () => 1_000_000 })
  return { outbox, post, data, queue: () => JSON.parse(data.get(OUTBOX_KEY) ?? '[]') }
}

describe('createMessageOutbox', () => {
  it('message noté puis envoyé, file vidée', async () => {
    const s = setup()
    const m = await s.outbox.add(1)
    expect(s.queue()).toEqual([{ id: 'm-1', slot: 1, sentAt: new Date(1_000_000).toISOString() }])
    expect(await s.outbox.flush()).toEqual({ sent: [m.id], refused: [] })
    expect(s.post).toHaveBeenCalledWith(m)
    expect(s.queue()).toEqual([])
  })

  it('hors ligne : gardé, puis envoyé une seule fois au retour du réseau (même identifiant)', async () => {
    const post = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({})
    const s = setup(post)
    await s.outbox.add(2)
    await s.outbox.add(3)
    expect(await s.outbox.flush()).toEqual({ sent: [], refused: [] })
    expect(s.queue().map((m: { slot: number }) => m.slot)).toEqual([2, 3])
    expect(await s.outbox.flush()).toEqual({ sent: ['m-1', 'm-2'], refused: [] })
    expect(post.mock.calls.map((c) => c[0].id)).toEqual(['m-1', 'm-1', 'm-2'])
    expect(s.queue()).toEqual([])
  })

  it('refus définitif retiré ; serveur saturé gardé ; session perdue vide la file', async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new DeviceError(400, 'invalid'))
      .mockRejectedValueOnce(new DeviceError(429, 'later'))
    const s = setup(post)
    await s.outbox.add(1)
    await s.outbox.add(4)
    expect(await s.outbox.flush()).toEqual({ sent: [], refused: ['m-1'] })
    expect(s.queue().map((m: { id: string }) => m.id)).toEqual(['m-2'])
    post.mockRejectedValueOnce(new DeviceError(401, 'lost'))
    expect(await s.outbox.flush()).toEqual({ sent: [], refused: ['m-2'] })
    expect(s.queue()).toEqual([])
  })

  it('session perdue pendant un envoi : clear() n’attend pas l’envoi (pas d’interblocage)', async () => {
    let release!: () => void
    const post = vi.fn(() => new Promise((_, reject) => { release = () => reject(new DeviceError(401, 'lost')) }))
    const s = setup(post as never)
    await s.outbox.add(1)
    const flushing = s.outbox.flush()
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    await s.outbox.clear()
    release()
    await flushing
    expect(s.queue()).toEqual([])
  })

  it('message ajouté pendant un envoi en cours : il part aussi, à la suite', async () => {
    let release!: () => void
    const post = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}) }))
      .mockResolvedValue({})
    const s = setup(post)
    await s.outbox.add(1)
    const first = s.outbox.flush()
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    const m2 = await s.outbox.add(2)
    const second = s.outbox.flush()
    release()
    expect((await first).sent).toEqual(['m-1'])
    expect((await second).sent).toEqual([m2.id])
    expect(s.queue()).toEqual([])
  })
})
