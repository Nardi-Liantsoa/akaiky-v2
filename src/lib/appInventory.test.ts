import { describe, expect, it, vi } from 'vitest'
import { appsRow, createInventorySync, INVENTORY_KEY, inventoryHash, MAX_INVENTORY, prepareInventory } from './appInventory'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const CALC = { package: 'com.android.calculator2', label: 'Calculatrice', icon: null }
const CAMERA = { package: 'com.android.camera2', label: 'Appareil photo', icon: PNG }
const CLOCK = { package: 'com.android.deskclock', label: 'Horloge', icon: null }

function memoryStore() {
  const data = new Map<string, string>()
  return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => { data.set(k, v) }, remove: async (k: string) => { data.delete(k) } }
}

describe('prepareInventory', () => {
  it('garde les entrées valables, triées par paquet, sans doublon', () => {
    expect(prepareInventory([CLOCK, CAMERA, CALC, { ...CALC, label: 'Autre' }])).toEqual([CALC, CAMERA, CLOCK])
  })
  it('écarte paquet invalide et nom vide ; nom nettoyé et coupé à 80 caractères', () => {
    const out = prepareInventory([
      { package: 'calculatrice', label: 'x', icon: null },
      { package: 'com.x-y.z', label: 'x', icon: null },
      { package: 'com.vide.app', label: ' \u0007 ', icon: null },
      { package: 'com.long.app', label: `\u0000${'é'.repeat(90)}`, icon: null }
    ])
    expect(out.map((a) => a.package)).toEqual(['com.long.app'])
    expect([...out[0].label]).toHaveLength(80)
  })
  it('icône gardée seulement si PNG en base64 de 4 Ko au plus', () => {
    const big = PNG + 'A'.repeat(6000)
    const out = prepareInventory([{ ...CAMERA, icon: big }, { ...CLOCK, icon: 'R0lGODlh' }, CALC])
    expect(out.map((a) => a.icon)).toEqual([null, null, null])
    expect(prepareInventory([CAMERA])[0].icon).toBe(PNG)
  })
  it('navigateur marqué gardé (browser: true seulement) ; empreinte différente', async () => {
    const out = prepareInventory([{ ...CALC, browser: true }, { ...CLOCK, browser: false }, { ...CAMERA, browser: 'oui' as unknown as boolean }])
    expect(out).toEqual([{ ...CALC, browser: true }, CAMERA, CLOCK])
    expect(await inventoryHash(prepareInventory([{ ...CALC, browser: true }]))).not.toBe(await inventoryHash(prepareInventory([CALC])))
  })
  it('150 applications au plus', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ package: `com.exemple.app${String(i).padStart(3, '0')}`, label: `App ${i}`, icon: null }))
    expect(prepareInventory(many)).toHaveLength(MAX_INVENTORY)
  })
})

describe('inventoryHash', () => {
  it('même inventaire, même empreinte, quel que soit l’ordre reçu ; changement → autre empreinte', async () => {
    const a = await inventoryHash(prepareInventory([CALC, CAMERA]))
    expect(await inventoryHash(prepareInventory([CAMERA, CALC]))).toBe(a)
    expect(await inventoryHash(prepareInventory([CALC, { ...CAMERA, label: 'Photo' }]))).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('createInventorySync', () => {
  it('envoie au premier relevé, pas quand rien ne change, de nouveau après un changement', async () => {
    const store = memoryStore()
    const put = vi.fn(async () => ({ count: 1 }))
    const sync = createInventorySync({ store, put })
    expect(await sync.sync('fy', [CAMERA, CALC])).toBe('sent')
    expect(put).toHaveBeenCalledWith({ apps: [CALC, CAMERA] })
    expect(await sync.sync('fy', [CALC, CAMERA])).toBe('unchanged')
    expect(await sync.sync('fy', [CALC])).toBe('sent')
    expect(put).toHaveBeenCalledTimes(2)
  })
  it('autre enfant (réappairage) : renvoyé ; envoi en échec : empreinte non gardée, renvoyé ensuite', async () => {
    const store = memoryStore()
    const put = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('hors ligne')).mockResolvedValueOnce({})
    const sync = createInventorySync({ store, put })
    await sync.sync('fy', [CALC])
    await expect(sync.sync('tiana', [CALC])).rejects.toThrow('hors ligne')
    expect(JSON.parse(store.data.get(INVENTORY_KEY)!).childId).toBe('fy')
    expect(await sync.sync('tiana', [CALC])).toBe('sent')
    await sync.clear()
    expect(store.data.has(INVENTORY_KEY)).toBe(false)
  })
  it('appelé pendant un envoi : un seul envoi de suite ensuite, avec les derniers arguments', async () => {
    let release!: () => void
    const put = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r })).mockResolvedValue({})
    const sync = createInventorySync({ store: memoryStore(), put })
    const first = sync.sync('fy', [CALC])
    const second = sync.sync('fy', [CALC, CAMERA])
    const third = sync.sync('fy', [CLOCK])
    expect(second).toBe(third)
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(put).toHaveBeenCalledTimes(1)
    release()
    expect(await first).toBe('sent')
    expect(await third).toBe('sent')
    expect(put).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenLastCalledWith({ apps: [CLOCK] })
  })
  it('envoi en échec pendant qu’un relevé attend : le suivant part quand même', async () => {
    const put = vi.fn().mockRejectedValueOnce(new Error('hors ligne')).mockResolvedValue({})
    const sync = createInventorySync({ store: memoryStore(), put })
    const first = sync.sync('fy', [CALC])
    const next = sync.sync('fy', [CAMERA])
    await expect(first).rejects.toThrow('hors ligne')
    expect(await next).toBe('sent')
    expect(put).toHaveBeenLastCalledWith({ apps: [CAMERA] })
  })
  it('deux relevés simultanés : un seul envoi', async () => {
    const put = vi.fn(async () => ({}))
    const sync = createInventorySync({ store: memoryStore(), put })
    await Promise.all([sync.sync('fy', [CALC]), sync.sync('fy', [CALC])])
    expect(put).toHaveBeenCalledTimes(1)
  })
})

describe('appsRow', () => {
  const allowed = [
    { package: CLOCK.package, label: 'Horloge', position: 2 },
    { package: CAMERA.package, label: 'Appareil photo', position: 1 },
    { package: 'com.absent.app', label: 'Absente', position: 3 }
  ]
  it('applications autorisées dans l’ordre du parent, présentes sur ce téléphone, avec l’icône locale', () => {
    expect(appsRow(allowed, [CALC, CAMERA, CLOCK], false)).toEqual([
      { package: CAMERA.package, label: 'Appareil photo', icon: PNG },
      { package: CLOCK.package, label: 'Horloge', icon: null }
    ])
  })
  it('aucune pendant une plage « école », ni sans liste', () => {
    expect(appsRow(allowed, [CAMERA, CLOCK], true)).toEqual([])
    expect(appsRow(undefined, [CAMERA], false)).toEqual([])
    expect(appsRow([], [CAMERA], false)).toEqual([])
  })
  it('application marquée navigateur (protégée) par le natif : écartée même autorisée', () => {
    expect(appsRow(allowed, [{ ...CAMERA, browser: true }, CLOCK], false)).toEqual([
      { package: CLOCK.package, label: 'Horloge', icon: null }
    ])
  })
})
