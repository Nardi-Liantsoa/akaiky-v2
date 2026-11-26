import { describe, expect, it, vi } from 'vitest'
import { createLockReporter, lockBody, relockDue, LOCK_MAX_S } from './lockReport'

describe('relockDue', () => {
  const opened = '2026-11-26T10:00:00.000Z'
  it('demande postérieure à l’ouverture de la sortie en cours : reverrouiller', () => {
    expect(relockDue('2026-11-26T10:00:01.000Z', opened)).toBe(true)
  })
  it('demande antérieure (une sortie précédente) ou égale : rien', () => {
    expect(relockDue('2026-11-26T09:59:59.000Z', opened)).toBe(false)
    expect(relockDue(opened, opened)).toBe(false)
  })
  it('aucune demande, ouverture inconnue (pas encore rapportée) ou date illisible : rien', () => {
    expect(relockDue(null, opened)).toBe(false)
    expect(relockDue(undefined, opened)).toBe(false)
    expect(relockDue('2026-11-26T10:05:00.000Z', null)).toBe(false)
    expect(relockDue('n’importe quoi', opened)).toBe(false)
  })
})

describe('lockBody', () => {
  const now = 1_000_000_000
  it('verrouillé, ou échéance passée : remainingS 0 seul', () => {
    expect(lockBody(undefined, null, now)).toEqual({ remainingS: 0 })
    expect(lockBody(now - 1, { source: 'code', startedAt: now - 900_000 }, now)).toEqual({ remainingS: 0 })
  })
  it('sortie ouverte : durées en secondes mesurées sur le téléphone, source de la sortie', () => {
    expect(lockBody(now + 600_400, { source: 'remote', startedAt: now - 120_600 }, now)).toEqual({ remainingS: 601, openedAgoS: 121, source: 'remote' })
  })
  it('sortie dont l’origine est inconnue (pas encore notée) : code, ouverte il y a 15 min − reste', () => {
    expect(lockBody(now + 300_000, null, now)).toEqual({ remainingS: 300, openedAgoS: LOCK_MAX_S - 300, source: 'code' })
  })
  it('bornées à 15 minutes (horloge déplacée, ouverture ancienne)', () => {
    expect(lockBody(now + 3_600_000, { source: 'code', startedAt: now - 7_200_000 }, now)).toEqual({ remainingS: LOCK_MAX_S, openedAgoS: LOCK_MAX_S, source: 'code' })
    expect(lockBody(now + 60_000, { source: 'code', startedAt: now + 5_000 }, now)).toEqual({ remainingS: 60, openedAgoS: 0, source: 'code' })
  })
})

describe('createLockReporter', () => {
  it('envoie un état une fois, garde l’ouverture rendue par le serveur ; même état : rien de renvoyé', async () => {
    const send = vi.fn(async (): Promise<{ unlockStartedAt: string | null }> => ({ unlockStartedAt: '2026-11-26T10:00:00.000Z' }))
    const r = createLockReporter({ send })
    await r.report({ remainingS: 600, openedAgoS: 0, source: 'code' }, 'open:code:1')
    await r.report({ remainingS: 590, openedAgoS: 10, source: 'code' }, 'open:code:1')
    expect(send).toHaveBeenCalledTimes(1)
    expect(r.startedAt()).toBe('2026-11-26T10:00:00.000Z')
    send.mockResolvedValueOnce({ unlockStartedAt: null })
    await r.report({ remainingS: 0 }, 'locked')
    expect(send).toHaveBeenCalledTimes(2)
    expect(r.startedAt()).toBeNull()
  })
  it('échec (hors ligne) : renvoyé au prochain appel ; l’ouverture connue est oubliée pour un autre état', async () => {
    const send = vi.fn(async (): Promise<{ unlockStartedAt: string | null }> => ({ unlockStartedAt: '2026-11-26T10:00:00.000Z' }))
    const r = createLockReporter({ send })
    await r.report({ remainingS: 600, openedAgoS: 0, source: 'code' }, 'open:code:1')
    send.mockRejectedValueOnce(new Error('offline'))
    await expect(r.report({ remainingS: 0 }, 'locked')).resolves.toBe(false)
    expect(r.startedAt()).toBeNull()
    await r.report({ remainingS: 0 }, 'locked')
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('deux rapports simultanés : envoyés l’un après l’autre, le dernier état gagne', async () => {
    const order: string[] = []
    let release!: () => void
    const send = vi.fn(async (b: { remainingS: number }) => {
      order.push(String(b.remainingS))
      if (b.remainingS === 600) await new Promise<void>((res) => { release = res })
      return { unlockStartedAt: b.remainingS ? 'x' : null }
    })
    const r = createLockReporter({ send })
    const a = r.report({ remainingS: 600, openedAgoS: 0, source: 'code' }, 'open:code:1')
    const b = r.report({ remainingS: 0 }, 'locked')
    await Promise.resolve()
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['600', '0'])
    expect(r.startedAt()).toBeNull()
  })
  it('reset : oublie tout (session perdue)', async () => {
    const send = vi.fn(async () => ({ unlockStartedAt: 'x' }))
    const r = createLockReporter({ send })
    await r.report({ remainingS: 600, openedAgoS: 0, source: 'code' }, 'k')
    r.reset()
    expect(r.startedAt()).toBeNull()
    await r.report({ remainingS: 600, openedAgoS: 0, source: 'code' }, 'k')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
