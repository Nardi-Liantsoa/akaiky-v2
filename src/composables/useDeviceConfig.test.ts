import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceError } from '../lib/deviceSession'
import { deviceConfig, pause, POLL_MS, resetDeviceConfig, resume, startDeviceConfig } from './useDeviceConfig'

const v = (version: number, names: string[]) => ({ version, contacts: names.map((name, i) => ({ id: name, name, phone: '+2613400000' + i, position: i + 1, avatarColor: 'orange' })) })

describe('useDeviceConfig', () => {
  beforeEach(() => { vi.useFakeTimers(); resetDeviceConfig() })
  afterEach(() => { resetDeviceConfig(); vi.useRealTimers() })

  it('dernière liste connue tout de suite, puis relevé ; un changement arrive en moins d’une minute', async () => {
    const refresh = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(v(4, ['Maman', 'Papa']))
    await startDeviceConfig({ load: async () => v(3, ['Maman']), refresh })
    expect(deviceConfig.config?.contacts.map((c) => c.name)).toEqual(['Maman'])
    resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(deviceConfig.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(deviceConfig.config?.contacts.map((c) => c.name)).toEqual(['Maman', 'Papa'])
    expect(POLL_MS).toBeLessThan(60_000)
  })

  it('arrière-plan : plus aucun relevé ; retour au premier plan : relevé immédiat', async () => {
    const refresh = vi.fn().mockResolvedValue(null)
    await startDeviceConfig({ load: async () => null, refresh })
    resume()
    await vi.advanceTimersByTimeAsync(0)
    pause()
    const calls = refresh.mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(refresh.mock.calls.length).toBe(calls)
    resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh.mock.calls.length).toBe(calls + 1)
  })

  it('hors ligne : la dernière liste reste affichée, état « hors ligne »', async () => {
    await startDeviceConfig({ load: async () => v(3, ['Maman']), refresh: async () => { throw new TypeError('Failed to fetch') } })
    resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(deviceConfig.status).toBe('offline')
    expect(deviceConfig.config?.contacts.map((c) => c.name)).toEqual(['Maman'])
  })

  it('téléphone retiré : liste effacée, relevés arrêtés', async () => {
    const refresh = vi.fn(async () => { throw new DeviceError(401, 'device_session_lost') })
    await startDeviceConfig({ load: async () => v(3, ['Maman']), refresh })
    resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(deviceConfig.status).toBe('lost')
    expect(deviceConfig.config).toBeNull()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(1)
    // Réappairé : un nouveau départ relève de nouveau.
    const again = vi.fn().mockResolvedValue(v(1, ['Papa']))
    await startDeviceConfig({ load: async () => null, refresh: again })
    resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(deviceConfig.config?.contacts.map((c) => c.name)).toEqual(['Papa'])
  })
})
