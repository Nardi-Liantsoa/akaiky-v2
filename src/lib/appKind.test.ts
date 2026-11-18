import { beforeEach, describe, expect, it, vi } from 'vitest'

// Frontières simulées : plateforme et identifiant natif de l'application.
const native = { value: false }
const getInfo = vi.fn()
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))
vi.mock('@capacitor/app', () => ({ App: { getInfo: () => getInfo() } }))

describe('appKind', () => {
  beforeEach(() => { vi.resetModules(); getInfo.mockReset() })

  it('identifiant de la variante enfant → enfant ; tout autre → parent', async () => {
    const { kindFromAppId } = await import('./appKind')
    expect(kindFromAppId('mg.nosytech.akaiky.enfant')).toBe('enfant')
    expect(kindFromAppId('mg.nosytech.akaiky')).toBe('parent')
    expect(kindFromAppId('mg.nosytech.akaiky.enfant.debug')).toBe('enfant')
    expect(kindFromAppId('mg.nosytech.akaiky.enfantin')).toBe('parent')
    expect(kindFromAppId('mg.nosytech.akaiky.debug')).toBe('parent')
    expect(kindFromAppId(undefined)).toBe('parent')
  })

  it('web : parent, sans appel natif', async () => {
    native.value = false
    const { appKind } = await import('./appKind')
    expect(await appKind()).toBe('parent')
    expect(getInfo).not.toHaveBeenCalled()
  })

  it('natif : lu une seule fois depuis l’identifiant de l’application', async () => {
    native.value = true
    getInfo.mockResolvedValue({ id: 'mg.nosytech.akaiky.enfant' })
    const { appKind } = await import('./appKind')
    expect(await appKind()).toBe('enfant')
    expect(await appKind()).toBe('enfant')
    expect(getInfo).toHaveBeenCalledTimes(1)
  })

  it('lecture native en échec : enfant (échec fermé), retenu pour tout le lancement', async () => {
    native.value = true
    getInfo.mockRejectedValueOnce(new Error('indisponible')).mockResolvedValue({ id: 'mg.nosytech.akaiky' })
    const { appKind, currentKind } = await import('./appKind')
    expect(currentKind.value).toBeNull()
    expect(await appKind()).toBe('enfant')
    expect(await appKind()).toBe('enfant')
    expect(currentKind.value).toBe('enfant')
    expect(getInfo).toHaveBeenCalledTimes(1)
  })

  it('natif, identifiant vide : enfant (échec fermé)', async () => {
    native.value = true
    getInfo.mockResolvedValue({ id: '' })
    const { appKind } = await import('./appKind')
    expect(await appKind()).toBe('enfant')
  })

  it('currentKind reprend la lecture (en-tête de l’app)', async () => {
    native.value = true
    getInfo.mockResolvedValue({ id: 'mg.nosytech.akaiky' })
    const { appKind, currentKind } = await import('./appKind')
    await appKind()
    expect(currentKind.value).toBe('parent')
  })
})
