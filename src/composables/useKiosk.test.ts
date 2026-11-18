import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AkaikyKioskPlugin, KioskStatus } from '../native/kiosk'
import { armKiosk, isUnlocked, kiosk, lockNow, unlockKiosk, useKioskPlugin } from './useKiosk'

// Natif simulé : fenêtre de sortie bornée à 15 min, comme KioskPolicy.
function fakeKiosk() {
  let until: number | undefined
  const status = (): KioskStatus => ({ deviceOwner: true, armed: true, locked: until === undefined, ...(until === undefined ? {} : { unlockedUntil: until }) })
  const p = {
    status: vi.fn(async () => status()),
    arm: vi.fn(async () => status()),
    disarm: vi.fn(async () => status()),
    unlockFor: vi.fn(async ({ minutes }: { minutes: number }) => { until = Date.now() + Math.min(minutes, 15) * 60_000; return status() }),
    lockNow: vi.fn(async () => { until = undefined; return status() }),
    openSettings: vi.fn(async () => {})
  } satisfies AkaikyKioskPlugin
  return p
}

describe('useKiosk', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T10:00:00Z')) })
  afterEach(() => { useKioskPlugin(null); vi.useRealTimers() })

  it('sortie de 15 minutes puis verrou remis à l’échéance', async () => {
    const p = fakeKiosk()
    useKioskPlugin(p)
    await armKiosk()
    expect(kiosk.status?.locked).toBe(true)
    await unlockKiosk()
    expect(p.unlockFor).toHaveBeenCalledWith({ minutes: 15 })
    expect(isUnlocked()).toBe(true)
    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1)
    expect(p.lockNow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(p.lockNow).toHaveBeenCalledTimes(1)
    expect(isUnlocked()).toBe(false)
  })

  it('reverrouiller avant l’échéance annule le rappel', async () => {
    const p = fakeKiosk()
    useKioskPlugin(p)
    await unlockKiosk()
    await lockNow()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(p.lockNow).toHaveBeenCalledTimes(1)
  })

  it('hors du téléphone de l’enfant : aucune action, aucun état', async () => {
    useKioskPlugin(null)
    expect(await unlockKiosk()).toBeNull()
    expect(kiosk.status).toBeNull()
  })
})
