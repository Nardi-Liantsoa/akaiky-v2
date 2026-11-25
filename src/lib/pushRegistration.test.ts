import { describe, expect, it, vi } from 'vitest'
import { createPushRegistration } from './pushRegistration'
import { pushType, routeForPush } from './pushRoute'

function setup({ permission = 'granted', token = 'T1', fail = false } = {}) {
  const sent: unknown[] = []
  let lang = 'fr'
  const messaging = {
    checkPermissions: vi.fn(async () => ({ receive: permission as never })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' as never })),
    getToken: vi.fn(async () => { if (fail) throw new Error('Firebase non configuré'); return { token } })
  }
  const reg = createPushRegistration({ messaging, send: async (r) => { sent.push(r) }, platform: 'android', lang: () => lang })
  return { reg, sent, messaging, setLang: (l: string) => { lang = l } }
}

describe('jeton push', () => {
  it('permission accordée : jeton envoyé une fois, puis à chaque changement de jeton ou de langue', async () => {
    const { reg, sent, setLang } = setup()
    expect(await reg.start()).toBe('granted')
    await reg.start()
    expect(sent).toEqual([{ token: 'T1', platform: 'android', lang: 'fr' }])
    await reg.tokenChanged('T2')
    setLang('mg')
    await reg.langChanged()
    expect(sent).toEqual([
      { token: 'T1', platform: 'android', lang: 'fr' },
      { token: 'T2', platform: 'android', lang: 'fr' },
      { token: 'T2', platform: 'android', lang: 'mg' }
    ])
  })

  it('permission non accordée : jamais demandée au démarrage, rien envoyé ; accordée après explication', async () => {
    const { reg, sent, messaging } = setup({ permission: 'prompt' })
    expect(await reg.start()).toBe('prompt')
    expect(messaging.requestPermissions).not.toHaveBeenCalled()
    expect(messaging.getToken).not.toHaveBeenCalled()
    await reg.enable()
    expect(sent).toEqual([{ token: 'T1', platform: 'android', lang: 'fr' }])
  })

  it('Firebase absent de la coque : « indisponible », sans erreur', async () => {
    const { reg, sent } = setup({ fail: true })
    expect(await reg.start()).toBe('unavailable')
    expect(sent).toEqual([])
  })

  it('session fermée : plus rien n’est envoyé', async () => {
    const { reg, sent } = setup()
    await reg.start()
    reg.stop()
    await reg.tokenChanged('T9')
    expect(sent).toHaveLength(1)
  })
})

describe('écran ouvert au toucher', () => {
  it('liste fermée ; type inconnu, absent ou URL : accueil', () => {
    expect(routeForPush({ type: 'message', id: 'm1' })).toEqual({ name: 'journal' })
    expect(routeForPush({ type: 'battery_low', id: 'c1' })).toEqual({ name: 'espace' })
    for (const data of [{ type: 'inconnu' }, { type: 'https://exemple.com/piege' }, { url: 'https://exemple.com' }, null, 'message', { type: '__proto__' }, { type: 'toString' }]) {
      expect(routeForPush(data)).toEqual({ name: 'espace' })
    }
    expect(pushType({ type: 'locate', id: 'c1' })).toBe('locate')
    expect(pushType({ id: 1 })).toBeNull()
  })
})
