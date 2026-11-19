import { describe, expect, it, vi } from 'vitest'
import { HEARTBEAT_EVERY_MS, HEARTBEAT_TIMEOUT_MS, createHeartbeat, heartbeatBody } from './heartbeat'
import type { DeviceStatus } from '../native/akaikyDevice'

const status = (over: Partial<DeviceStatus> = {}): DeviceStatus => ({ battery: 80, charging: false, network: 'wifi', ...over })

describe('heartbeatBody', () => {
  it('relevé natif → corps du serveur ; carte SIM inconnue tant que le natif ne la donne pas (NAR-180)', () => {
    expect(heartbeatBody(status())).toEqual({ batteryPct: 80, charging: false, network: 'wifi', simState: 'unknown' })
    expect(heartbeatBody({ network: 'cellular', battery: 14.6, simState: 'absent' })).toEqual({ batteryPct: 15, charging: null, network: 'mobile', simState: 'absent' })
    expect(heartbeatBody({ network: 'other', battery: -1 }).batteryPct).toBeNull()
    expect(heartbeatBody({ network: 'other' }).network).toBe('wifi')
    expect(heartbeatBody({ network: 'none', battery: 150 })).toEqual({ batteryPct: null, charging: null, network: 'none', simState: 'unknown' })
  })

  it('relevé natif en échec : tout inconnu ; « aucun réseau » seulement si le navigateur se sait hors ligne ; jamais de background', () => {
    expect(heartbeatBody(null)).toEqual({ batteryPct: null, charging: null, network: 'unknown', simState: 'unknown' })
    expect(heartbeatBody(null, true).network).toBe('unknown')
    expect(heartbeatBody(null, false).network).toBe('none')
    expect('background' in heartbeatBody(null)).toBe(false)
    expect('background' in heartbeatBody(status())).toBe(false)
  })
})

describe('createHeartbeat', () => {
  function setup(post: (body: unknown) => Promise<unknown> = vi.fn(async () => ({})), online: () => boolean | undefined = () => true) {
    let clock = 1_000_000
    const hb = createHeartbeat({ post, now: () => clock, online })
    return { hb, post, advance: (ms: number) => { clock += ms } }
  }

  it('au démarrage, puis toutes les 15 minutes seulement', async () => {
    const s = setup()
    expect(await s.hb.tick(status())).toBe(true)
    s.advance(60_000)
    expect(await s.hb.tick(status({ battery: 79 }))).toBe(false)
    s.advance(HEARTBEAT_EVERY_MS - 60_000)
    expect(await s.hb.tick(status({ battery: 70 }))).toBe(true)
    expect(s.post).toHaveBeenCalledTimes(2)
    expect(s.post).toHaveBeenLastCalledWith({ batteryPct: 70, charging: false, network: 'wifi', simState: 'unknown' })
  })

  it('tout de suite quand la batterie passe sous 15 % ou que la carte SIM change ; pas deux fois', async () => {
    const s = setup()
    await s.hb.tick(status({ battery: 16 }))
    s.advance(60_000)
    expect(await s.hb.tick(status({ battery: 14 }))).toBe(true)
    s.advance(60_000)
    // Déjà sous le seuil : rien de plus.
    expect(await s.hb.tick(status({ battery: 13 }))).toBe(false)
    s.advance(60_000)
    expect(await s.hb.tick(status({ battery: 13, simState: 'absent' }))).toBe(true)
    s.advance(60_000)
    expect(await s.hb.tick(status({ battery: 13, simState: 'absent' }))).toBe(false)
    expect(s.post).toHaveBeenCalledTimes(3)
  })

  it('hors ligne : rien de noté, la minute suivante réessaie', async () => {
    const post = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({})
    const s = setup(post)
    expect(await s.hb.tick(status())).toBe(false)
    s.advance(60_000)
    expect(await s.hb.tick(status())).toBe(true)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('relevé natif en échec : le signal part quand même, valeurs inconnues ; puis toutes les 15 minutes', async () => {
    let online: boolean | undefined = true
    const s = setup(undefined, () => online)
    expect(await s.hb.tick(null)).toBe(true)
    expect(s.post).toHaveBeenLastCalledWith({ batteryPct: null, charging: null, network: 'unknown', simState: 'unknown' })
    s.advance(60_000)
    expect(await s.hb.tick(null)).toBe(false)
    online = false
    s.advance(HEARTBEAT_EVERY_MS)
    expect(await s.hb.tick(null)).toBe(true)
    expect(s.post).toHaveBeenLastCalledWith({ batteryPct: null, charging: null, network: 'none', simState: 'unknown' })
    expect(s.post).toHaveBeenCalledTimes(2)
  })

  it('reset pendant un envoi : l’envoi qui finit après n’est pas noté, la nouvelle session repart d’un premier signal', async () => {
    const releases: Array<() => void> = []
    const post = vi.fn(() => new Promise<unknown>((r) => { releases.push(() => r(undefined)) }))
    const s = setup(post)
    const old = s.hb.tick(status())
    s.hb.reset()
    // Nouvelle session : premier signal tout de suite, sans attendre l'ancien envoi.
    const fresh = s.hb.tick(status({ battery: 70 }))
    releases[0]()
    expect(await old).toBe(false)
    releases[1]()
    expect(await fresh).toBe(true)
    // L'ancien envoi n'a rien écrit ; le nouveau sert de référence (pas de nouvel envoi).
    s.advance(60_000)
    expect(await s.hb.tick(status({ battery: 70 }))).toBe(false)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('reset pendant un envoi : sans nouvel envoi, la nouvelle session envoie au prochain relevé', async () => {
    let release = () => {}
    const post = vi.fn(() => new Promise<unknown>((r) => { release = () => r(undefined) }))
    const s = setup(post)
    const old = s.hb.tick(status())
    s.hb.reset()
    release()
    expect(await old).toBe(false)
    s.advance(60_000)
    const next = s.hb.tick(status())
    release()
    expect(await next).toBe(true)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('un seul envoi à la fois', async () => {
    let release = () => {}
    const post = vi.fn(() => new Promise<unknown>((r) => { release = () => r(undefined) }))
    const s = setup(post)
    const first = s.hb.tick(status())
    expect(await s.hb.tick(status())).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('envoi sans réponse : abandonné après le délai, non noté, le relevé suivant renvoie', async () => {
    vi.useFakeTimers()
    try {
      const post = vi.fn(() => new Promise<unknown>(() => {}))
      const s = setup(post)
      const first = s.hb.tick(status())
      expect(await s.hb.tick(status())).toBe(false)
      await vi.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS)
      expect(await first).toBe(false)
      const second = s.hb.tick(status())
      expect(post).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS)
      expect(await second).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
