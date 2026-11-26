import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSosOnline, OPEN_RETRY_MS, POSITION_EVERY_MS, SOS_ONLINE_MS } from './sosOnline'
import { DeviceError } from './deviceSession'

const FIX = { lat: -18.9, lng: 47.5, accuracyM: 10, ageS: 1 }

function setup(over: { post?: (path: string, body?: unknown) => Promise<unknown>, fix?: () => Promise<typeof FIX> } = {}) {
  const calls: [string, unknown][] = []
  const post = vi.fn(over.post ?? (async (path: string) => (path === '/device/sos' ? { id: 'sos-1', status: 'active' } : { ok: true })))
  const fix = vi.fn(over.fix ?? (async () => FIX))
  const s = createSosOnline({
    post: async (path, body) => { calls.push([path, body]); return post(path, body) },
    fix, cancelFix: vi.fn(async () => {}), uuid: () => 'c-1'
  })
  return { s, post, fix, calls, paths: () => calls.map(([p]) => p) }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('createSosOnline', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ouvre l’alerte, envoie la position tout de suite puis toutes les 30 s, s’arrête à 15 min', async () => {
    const t = setup()
    t.s.start()
    await flush()
    expect(t.calls[0]).toEqual(['/device/sos', { clientId: 'c-1' }])
    expect(t.calls[1]).toEqual(['/device/sos/sos-1/positions', FIX])
    await vi.advanceTimersByTimeAsync(POSITION_EVERY_MS)
    expect(t.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(SOS_ONLINE_MS)
    const sent = t.paths().filter((p) => p.endsWith('/positions')).length
    expect(sent).toBe(SOS_ONLINE_MS / POSITION_EVERY_MS)
    await vi.advanceTimersByTimeAsync(10 * POSITION_EVERY_MS)
    expect(t.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(sent)
    expect(t.s.active()).toBe(false)
  })

  it('hors ligne : l’ouverture est retentée (même clientId) jusqu’à passer', async () => {
    let fails = 2
    const t = setup({ post: async (path) => { if (path === '/device/sos' && fails-- > 0) throw new Error('offline'); return path === '/device/sos' ? { id: 'sos-1' } : { ok: true } } })
    t.s.start()
    await flush()
    await vi.advanceTimersByTimeAsync(OPEN_RETRY_MS * 2)
    expect(t.calls.filter(([p]) => p === '/device/sos').map(([, b]) => b)).toEqual([{ clientId: 'c-1' }, { clientId: 'c-1' }, { clientId: 'c-1' }])
    expect(t.paths()).toContain('/device/sos/sos-1/positions')
  })

  it('alerte terminée par le serveur (prise en charge, 15 min) : plus de position', async () => {
    const t = setup({ post: async (path) => { if (path.endsWith('/positions')) throw new DeviceError(409, 'sos_closed'); return { id: 'sos-1' } } })
    t.s.start()
    await flush()
    await vi.advanceTimersByTimeAsync(POSITION_EVERY_MS * 3)
    expect(t.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(1)
    expect(t.s.active()).toBe(false)
  })

  it('relevé impossible : rien n’est envoyé à ce tour, le suivant réessaie', async () => {
    let n = 0
    const t = setup({ fix: async () => { if (n++ === 0) throw new Error('timeout'); return FIX } })
    t.s.start()
    await flush()
    expect(t.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(POSITION_EVERY_MS)
    expect(t.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(1)
  })

  it('annulation acceptée : arrêt ; refusée (trop tard) : l’alerte reste et la position continue', async () => {
    const t = setup()
    t.s.start()
    await flush()
    await t.s.cancel()
    expect(t.paths()).toContain('/device/sos/sos-1/cancel')
    expect(t.s.active()).toBe(false)

    const late = setup({ post: async (path) => { if (path.endsWith('/cancel')) throw new DeviceError(409, 'sos_too_late'); return path === '/device/sos' ? { id: 'sos-1' } : { ok: true } } })
    late.s.start()
    await flush()
    await late.s.cancel()
    expect(late.s.active()).toBe(true)
    await vi.advanceTimersByTimeAsync(POSITION_EVERY_MS)
    expect(late.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(2)
  })

  it('annulation avant que l’alerte soit ouverte : elle est annulée dès son ouverture, sans position', async () => {
    let release!: () => void
    const t = setup({ post: async (path) => { if (path === '/device/sos') { await new Promise<void>((r) => { release = r }); return { id: 'sos-1' } } return { ok: true } } })
    t.s.start()
    await flush()
    const cancelling = t.s.cancel()
    release()
    await cancelling
    await flush()
    expect(t.paths()).toEqual(['/device/sos', '/device/sos/sos-1/cancel'])
  })

  it('un seul SOS à la fois ; stop() arrête tout, sans nouvel envoi', async () => {
    const t = setup()
    t.s.start()
    t.s.start()
    await flush()
    expect(t.paths().filter((p) => p === '/device/sos')).toHaveLength(1)
    t.s.stop()
    await vi.advanceTimersByTimeAsync(POSITION_EVERY_MS * 3)
    expect(t.paths().filter((p) => p.endsWith('/positions'))).toHaveLength(1)
  })
})
