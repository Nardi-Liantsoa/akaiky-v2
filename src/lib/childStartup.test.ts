import { describe, expect, it, vi } from 'vitest'
import { startChild, type ChildDeps } from './childStartup'
import { DeviceError, type DeviceSession } from './deviceSession'

// Session et greffon natif simulés : on vérifie l'enchaînement, pas le réseau.
function deps({ session = false, token = null as string | null, pair = async () => ({ device: { id: 'd' }, child: { id: 'c' } }), me = async () => ({ child: { firstName: 'Fy' } }) as unknown } = {}) {
  let stored = token
  const d: ChildDeps & { cleared: () => boolean } = {
    session: { hasSession: async () => session, pair: vi.fn(pair), get: vi.fn(me) } as unknown as DeviceSession,
    provisioning: { token: async () => stored, clear: async () => { stored = null } },
    info: async () => ({ model: 'Pixel' }),
    cleared: () => stored === null
  }
  return d
}

describe('startChild', () => {
  it('sans session ni jeton : attente', async () => {
    expect(await startChild(deps())).toEqual({ kind: 'waiting' })
  })

  it('jeton du QR : échangé, effacé, puis écran de l’enfant', async () => {
    const d = deps({ token: 't' })
    expect(await startChild(d)).toEqual({ kind: 'paired', firstName: 'Fy' })
    expect(d.session.pair).toHaveBeenCalledWith('t', { model: 'Pixel' })
    expect(d.cleared()).toBe(true)
  })

  it('jeton expiré ou déjà utilisé : message, jeton effacé', async () => {
    const d = deps({ token: 't', pair: async () => { throw new DeviceError(401, 'pairing_invalid') } })
    expect(await startChild(d)).toEqual({ kind: 'expired' })
    expect(d.cleared()).toBe(true)
  })

  it('plafond de téléphones atteint : message dédié, jeton gardé (encore valable)', async () => {
    const d = deps({ token: 't', pair: async () => { throw new DeviceError(409, 'too_many_devices') } })
    expect(await startChild(d)).toEqual({ kind: 'tooMany' })
    expect(d.cleared()).toBe(false)
  })

  it('autre refus (400, 403…) : « échec », pas « hors ligne » ni « expiré », jeton gardé', async () => {
    const d = deps({ token: 't', pair: async () => { throw new DeviceError(400, null) } })
    expect(await startChild(d)).toEqual({ kind: 'failed' })
    expect(d.cleared()).toBe(false)
  })

  it('session saine : le greffon n’est pas consulté (même en panne)', async () => {
    const d = deps({ session: true })
    d.provisioning.token = async () => { throw new Error('greffon absent') }
    expect(await startChild(d)).toEqual({ kind: 'paired', firstName: 'Fy' })
  })

  it('effacement du jeton en échec après un appairage réussi : écran de l’enfant quand même', async () => {
    const d = deps({ token: 't' })
    d.provisioning.clear = async () => { throw new Error('greffon') }
    expect(await startChild(d)).toEqual({ kind: 'paired', firstName: 'Fy' })
  })

  it('hors ligne pendant l’échange : jeton gardé pour un nouvel essai', async () => {
    const d = deps({ token: 't', pair: async () => { throw new TypeError('Failed to fetch') } })
    expect(await startChild(d)).toEqual({ kind: 'offline' })
    expect(d.cleared()).toBe(false)
  })

  it('session existante : écran de l’enfant sans nouvel échange', async () => {
    const d = deps({ session: true, token: 't' })
    expect(await startChild(d)).toEqual({ kind: 'paired', firstName: 'Fy' })
    expect(d.session.pair).not.toHaveBeenCalled()
  })

  it('session refusée (téléphone retiré) sans jeton : retiré ; hors ligne : rien n’est perdu', async () => {
    expect(await startChild(deps({ session: true, me: async () => { throw new DeviceError(401, 'device_session_lost') } }))).toEqual({ kind: 'revoked' })
    expect(await startChild(deps({ session: true, me: async () => { throw new TypeError('offline') } }))).toEqual({ kind: 'offline' })
    // 404 ou 403 inattendu : pas « retiré », on réessaiera.
    expect(await startChild(deps({ session: true, me: async () => { throw new DeviceError(404, null) } }))).toEqual({ kind: 'failed' })
    expect(await startChild(deps({ session: true, me: async () => { throw new DeviceError(503, null) } }))).toEqual({ kind: 'offline' })
  })
})
