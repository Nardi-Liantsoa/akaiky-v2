import { describe, expect, it, vi } from 'vitest'
import { createPushRegistration, notConfigured, retryable, RETRY_MS } from './pushRegistration'
import { pushType, routeForPush } from './pushRoute'

function setup({ permission = 'granted', token = 'T1', tokenError = null as unknown, sendFails = 0 } = {}) {
  const sent: unknown[] = []
  let lang = 'fr'
  let failures = sendFails
  let tokenErr = tokenError
  const messaging = {
    checkPermissions: vi.fn(async () => ({ receive: permission as never })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' as never })),
    getToken: vi.fn(async () => { if (tokenErr) { const e = tokenErr; tokenErr = null; throw e } return { token } })
  }
  const send = async (r: unknown) => { if (failures > 0) { failures--; throw new Error('hors ligne') } sent.push(r) }
  const reg = createPushRegistration({ messaging, send, platform: 'android', lang: () => lang })
  return { reg, sent, messaging, setLang: (l: string) => { lang = l }, failTokenOnce: (e: unknown) => { tokenErr = e } }
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
    // Jeton rafraîchi par FCM sans permission : pas envoyé.
    await reg.tokenChanged('T0')
    expect(sent).toEqual([])
    await reg.enable()
    expect(sent).toEqual([{ token: 'T1', platform: 'android', lang: 'fr' }])
  })

  it('Firebase absent de la coque : « indisponible », sans erreur ni nouvel essai', async () => {
    vi.useFakeTimers()
    try {
      const { reg, sent, messaging } = setup({ tokenError: Object.assign(new Error('Firebase is not configured'), { code: 'UNAVAILABLE' }) })
      expect(await reg.start()).toBe('unavailable')
      await vi.advanceTimersByTimeAsync(RETRY_MS * 3)
      expect(messaging.getToken).toHaveBeenCalledTimes(1)
      expect(sent).toEqual([])
    } finally { vi.useRealTimers() }
  })

  it('jeton pas encore prêt ou envoi refusé : retenté toutes les 30 s tant que la session est ouverte', async () => {
    vi.useFakeTimers()
    try {
      const { reg, sent } = setup({ tokenError: new Error('No APNS token specified'), sendFails: 1 })
      expect(await reg.start()).toBe('granted')
      expect(sent).toEqual([])
      await vi.advanceTimersByTimeAsync(RETRY_MS) // jeton obtenu, envoi refusé (hors ligne)
      expect(sent).toEqual([])
      await vi.advanceTimersByTimeAsync(RETRY_MS) // envoi réussi
      expect(sent).toEqual([{ token: 'T1', platform: 'android', lang: 'fr' }])
      reg.stop()
      await reg.start()
      expect(sent).toHaveLength(2) // nouvelle session : renvoyé
    } finally { vi.useRealTimers() }
  })

  it('erreur « non configuré » reconnue sur iOS et Android, pas les autres', () => {
    expect(notConfigured({ code: 'UNAVAILABLE', message: 'x' })).toBe(true)
    expect(notConfigured(new Error('Default FirebaseApp is not initialized in this process mg.nosytech.akaiky.'))).toBe(true)
    expect(notConfigured({ code: 'UNIMPLEMENTED', message: '"FirebaseMessaging" plugin is not implemented on android' })).toBe(true)
    expect(notConfigured(new Error('SERVICE_NOT_AVAILABLE'))).toBe(false)
    expect(notConfigured(null)).toBe(false)
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
    // SOS (NAR-249) : écran de l'alerte ; identifiant mal formé (ou une URL) : l'accueil.
    const id = '6f1c2b1e-0000-4000-8000-0000000005a1'
    expect(routeForPush({ type: 'sos', id })).toEqual({ name: 'sos', params: { id } })
    expect(routeForPush({ type: 'sos_cancelled', id: id.toUpperCase() })).toEqual({ name: 'sos', params: { id } })
    for (const bad of ['../journal', 'https://evil.example/', '', undefined]) expect(routeForPush({ type: 'sos', id: bad })).toEqual({ name: 'espace' })
    for (const data of [{ type: 'inconnu' }, { type: 'https://exemple.com/piege' }, { url: 'https://exemple.com' }, null, 'message', { type: '__proto__' }, { type: 'toString' }]) {
      expect(routeForPush(data)).toEqual({ name: 'espace' })
    }
    expect(pushType({ type: 'locate', id: 'c1' })).toBe('locate')
    expect(pushType({ id: 1 })).toBeNull()
  })
})

describe('jeton push : sessions qui se suivent', () => {
  it('un envoi en cours pendant la fermeture ne bloque pas l’envoi pour la session suivante', async () => {
    const sent: string[] = []
    let release: () => void = () => {}
    let first = true
    const messaging = { checkPermissions: async () => ({ receive: 'granted' as never }), requestPermissions: async () => ({ receive: 'granted' as never }), getToken: async () => ({ token: 'T1' }) }
    const send = (r: { token: string }) => {
      if (first) { first = false; return new Promise<void>((res) => { release = () => { sent.push(`lent:${r.token}`); res() } }) }
      sent.push(r.token)
      return Promise.resolve()
    }
    const reg = createPushRegistration({ messaging, send, platform: 'android', lang: () => 'fr' })
    const pending = reg.start()
    await new Promise((r) => setTimeout(r, 0))
    reg.stop() // déconnexion pendant l'envoi
    const next = reg.start() // nouvelle session
    release()
    await pending
    await next
    expect(sent).toEqual(['lent:T1', 'T1'])
  })

  it('refus définitif (400, 401) : pas de nouvel essai ; réseau, 429, 5xx : nouvel essai', () => {
    expect(retryable({ status: 400 })).toBe(false)
    expect(retryable({ status: 401 })).toBe(false)
    expect(retryable({ status: 0 })).toBe(true)
    expect(retryable({ status: 429 })).toBe(true)
    expect(retryable({ status: 503 })).toBe(true)
    expect(retryable(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('jeton push : permission retirée', () => {
  it('permission retirée dans les réglages : jeton retiré du serveur, plus rien n’est envoyé', async () => {
    let permission = 'granted'
    const sent: string[] = []
    const removed: string[] = []
    const messaging = { checkPermissions: async () => ({ receive: permission as never }), requestPermissions: async () => ({ receive: 'granted' as never }), getToken: async () => ({ token: 'T1' }) }
    const reg = createPushRegistration({ messaging, send: async (r) => { sent.push(r.token) }, remove: async (t) => { removed.push(t) }, platform: 'android', lang: () => 'fr' })
    await reg.start()
    await new Promise((r) => setTimeout(r, 0))
    permission = 'denied'
    expect(await reg.start()).toBe('denied')
    await reg.tokenChanged('T2')
    expect(sent).toEqual(['T1'])
    expect(removed).toEqual(['T1'])
  })
})
