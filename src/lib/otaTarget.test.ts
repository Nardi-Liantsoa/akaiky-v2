import { describe, expect, it, vi } from 'vitest'
import shared from '../../tests/fixtures/ota-target-cases.json'

// Frontière simulée : l'identité native de l'application.
const getInfo = vi.fn()
vi.mock('@capacitor/app', () => ({ App: { getInfo: () => getInfo() } }))

const { otaVerdict, readShell, channelBelongsTo, targetFromData } = await import('./otaTarget')
const { kindFromAppId } = await import('./appKind')

describe('otaVerdict (cas partagés)', () => {
  it.each(shared.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(otaVerdict(c.target, c.shell)).toBe(c.verdict)
  })

  it('un bundle publié pour une app n’est jamais accepté par l’autre', () => {
    for (const [app, shell] of Object.entries(shared.shells)) {
      const other = app === 'parent' ? shared.shells.enfant : shared.shells.parent
      const target = { app, channel: shell.channel, minNativeBuild: 1 }
      expect(otaVerdict(target, { appId: shell.applicationId, build: '1' })).toBe('accept')
      expect(otaVerdict(target, { appId: other.applicationId, build: '99' })).toBe('wrong-app')
    }
  })
})

describe('targetFromData (cible en chaînes, cas partagés)', () => {
  it('relit exactement chaque forme écrite par le serveur', () => {
    for (const c of shared.data.canonical) {
      expect(targetFromData(c.data)).toEqual(c.target)
      expect(otaVerdict(targetFromData(c.data), { appId: c.target.app === 'enfant' ? 'mg.nosytech.akaiky.enfant' : 'mg.nosytech.akaiky', build: '2100000000' })).toBe('accept')
    }
  })
  it.each(shared.data.refused.map((d) => [JSON.stringify(d), d] as const))('refuse %s (verdict invalid)', (_n, d) => {
    expect(targetFromData(d)).toBeNull()
    expect(otaVerdict(targetFromData(d), { appId: 'mg.nosytech.akaiky', build: '9' })).toBe('invalid')
  })
})

describe('identités des coques', () => {
  it('chaque coque a le canal de son app, et ce canal n’appartient pas à l’autre', () => {
    for (const [app, shell] of Object.entries(shared.shells)) {
      expect(kindFromAppId(shell.applicationId)).toBe(app)
      expect(shell.channel).toBe(app)
      const other = app === 'parent' ? 'enfant' : 'parent'
      expect(channelBelongsTo(shell.channel, other)).toBe(false)
    }
  })
})

describe('readShell', () => {
  it('lit identifiant et versionCode natifs', async () => {
    getInfo.mockResolvedValueOnce({ id: 'mg.nosytech.akaiky.enfant', build: '4', version: '1.0', name: 'Akaiky' })
    expect(await readShell()).toEqual({ appId: 'mg.nosytech.akaiky.enfant', build: '4' })
  })

  it('lecture native en échec : coque inconnue, rien n’est accepté', async () => {
    getInfo.mockRejectedValueOnce(new Error('not implemented'))
    const shell = await readShell()
    expect(otaVerdict({ app: 'parent', channel: 'parent', minNativeBuild: 1 }, shell)).toBe('unknown-shell')
  })
})
