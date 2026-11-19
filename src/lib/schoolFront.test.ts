import { describe, expect, it, vi } from 'vitest'
import { createSchoolFront } from './schoolFront'

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(answers: boolean[]) {
  const bring = vi.fn(async () => ({ brought: answers.shift() ?? false }))
  const refresh = vi.fn(async () => ({}))
  return { bring, refresh, tick: createSchoolFront({ bring, refresh }) }
}

describe('createSchoolFront', () => {
  it('pendant une plage, app derrière : redemandée à chaque tour jusqu’à brought: true', async () => {
    const { bring, tick } = setup([false, false, true])
    for (let i = 0; i < 5; i++) { tick({ school: true, foreground: false, active: true }); await flush() }
    expect(bring).toHaveBeenCalledTimes(3)
  })

  it('verrou réappliqué au début et à la fin de la plage seulement', async () => {
    const { refresh, tick } = setup([])
    tick({ school: true, foreground: true, active: true })
    tick({ school: true, foreground: true, active: true })
    tick({ school: false, foreground: true, active: true })
    tick({ school: false, foreground: true, active: true })
    await flush()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('app devant ou hors plage : jamais ramenée', async () => {
    const { bring, tick } = setup([])
    tick({ school: true, foreground: true, active: true })
    tick({ school: false, foreground: false, active: true })
    await flush()
    expect(bring).not.toHaveBeenCalled()
  })

  it('ramenée, puis de nouveau derrière pendant la plage : redemandée', async () => {
    const { bring, tick } = setup([true, true])
    tick({ school: true, foreground: false, active: true }); await flush()
    tick({ school: true, foreground: false, active: true }); await flush()
    expect(bring).toHaveBeenCalledTimes(1)
    tick({ school: true, foreground: true, active: true }); await flush()
    tick({ school: true, foreground: false, active: true }); await flush()
    expect(bring).toHaveBeenCalledTimes(2)
  })

  it('un seul appel natif en cours, et rien hors téléphone appairé', async () => {
    let release: (v: { brought: boolean }) => void = () => {}
    const bring = vi.fn(() => new Promise<{ brought: boolean }>((r) => { release = r }))
    const refresh = vi.fn(async () => ({}))
    const tick = createSchoolFront({ bring, refresh })
    tick({ school: true, foreground: false, active: true })
    tick({ school: true, foreground: false, active: true })
    expect(bring).toHaveBeenCalledTimes(1)
    release({ brought: false }); await flush()
    tick({ school: true, foreground: false, active: false })
    expect(bring).toHaveBeenCalledTimes(1)
  })

  it('refus natif (erreur) : nouvel essai au tour suivant', async () => {
    const bring = vi.fn(async () => { throw new Error('x') })
    const tick = createSchoolFront({ bring, refresh: async () => ({}) })
    tick({ school: true, foreground: false, active: true }); await flush()
    tick({ school: true, foreground: false, active: true }); await flush()
    expect(bring).toHaveBeenCalledTimes(2)
  })
})
