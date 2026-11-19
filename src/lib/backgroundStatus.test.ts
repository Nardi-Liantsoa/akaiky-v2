import { describe, expect, it, vi } from 'vitest'
import { createBackgroundStatus } from './backgroundStatus'

function setup() {
  const state = { enabled: false, needsToken: false }
  let n = 0
  const session = { post: vi.fn(async (path: string) => { expect(path).toBe('/device/heartbeat-token'); return { token: `t${++n}` } as never }) }
  const plugin = {
    startBackgroundStatus: vi.fn(async () => { state.enabled = true; state.needsToken = false }),
    stopBackgroundStatus: vi.fn(async () => { state.enabled = false }),
    status: vi.fn(async () => ({ ...state }))
  }
  return { state, session, plugin, bg: createBackgroundStatus({ session, plugin, apiBase: 'https://api.test/api' }) }
}

describe('createBackgroundStatus', () => {
  it('émet un jeton par la session d’appareil et le confie au natif, une fois par lancement', async () => {
    const { session, plugin, bg } = setup()
    await bg.ensure()
    expect(plugin.startBackgroundStatus).toHaveBeenCalledWith({ apiBase: 'https://api.test/api', token: 't1' })
    await bg.ensure()
    await bg.ensure()
    expect(session.post).toHaveBeenCalledTimes(1)
  })

  it('jeton refusé ou illisible côté natif (needsToken) : nouveau jeton au retour au premier plan', async () => {
    const { state, session, plugin, bg } = setup()
    await bg.ensure()
    state.needsToken = true
    state.enabled = false
    await bg.ensure()
    expect(session.post).toHaveBeenCalledTimes(2)
    expect(plugin.startBackgroundStatus).toHaveBeenLastCalledWith({ apiBase: 'https://api.test/api', token: 't2' })
    // Illisible sans arrêt : en route, mais needsToken.
    state.needsToken = true
    await bg.ensure()
    expect(session.post).toHaveBeenCalledTimes(3)
  })

  it('hors ligne : rien de lancé, nouvel essai à l’appel suivant', async () => {
    const { session, plugin, bg } = setup()
    session.post.mockRejectedValueOnce(new Error('offline'))
    await bg.ensure()
    expect(plugin.startBackgroundStatus).not.toHaveBeenCalled()
    await bg.ensure()
    expect(plugin.startBackgroundStatus).toHaveBeenCalledTimes(1)
  })

  it('arrêt pendant une émission : le jeton arrivé après n’est jamais confié au natif', async () => {
    const { session, plugin, bg } = setup()
    let answer!: (v: { token: string }) => void
    session.post.mockImplementationOnce(() => new Promise((r) => { answer = r as never }) as never)
    const pending = bg.ensure()
    await bg.stop()
    // Appairé de nouveau avant la réponse : nouvelle émission, l'ancienne abandonne.
    const again = bg.ensure()
    answer({ token: 'late' })
    await pending
    await again
    expect(plugin.stopBackgroundStatus).toHaveBeenCalledTimes(1)
    expect(plugin.startBackgroundStatus).toHaveBeenCalledTimes(1)
    expect(plugin.startBackgroundStatus).toHaveBeenCalledWith({ apiBase: 'https://api.test/api', token: 't1' })
  })

  it('greffon absent (web) : aucune erreur', async () => {
    const { plugin, bg } = setup()
    plugin.startBackgroundStatus.mockRejectedValue(new Error('not implemented'))
    plugin.stopBackgroundStatus.mockRejectedValue(new Error('not implemented'))
    await expect(bg.ensure()).resolves.toBeUndefined()
    await expect(bg.stop()).resolves.toBeUndefined()
  })
})
