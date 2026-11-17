import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/http'

// Frontière simulée : l'appel réseau. Le reste (état, transitions) est le vrai code.
const getMyFamily = vi.fn()
vi.mock('../api/families', () => ({ getMyFamily: () => getMyFamily() }))

const { auth } = await import('./auth')
const { family, loadFamily, canManage } = await import('./family')

const FAMILY = { id: 'f1', name: 'Rabe', role: 'owner' as const, members: [] }
const login = (id: string) => { auth.user = { id, email: `${id}@x.fr`, name: id, is_admin: false } }

describe('famille de la session', () => {
  beforeEach(() => { getMyFamily.mockReset(); auth.user = null })

  it('chargée une fois, puis servie depuis l’état', async () => {
    login('a')
    getMyFamily.mockResolvedValue(FAMILY)
    await loadFamily()
    await loadFamily()
    expect(family.status).toBe('ready')
    expect(family.data?.name).toBe('Rabe')
    expect(getMyFamily).toHaveBeenCalledTimes(1)
    expect(canManage()).toBe(true)
  })

  it('404 no_family : pas encore de famille', async () => {
    login('b')
    getMyFamily.mockRejectedValue(new ApiError(404, 'Famille introuvable.', 'no_family'))
    await loadFamily()
    expect(family.status).toBe('none')
    expect(canManage()).toBe(false)
  })

  it('réseau coupé : erreur, jamais « pas de famille »', async () => {
    login('c')
    getMyFamily.mockRejectedValue(new ApiError(0, 'network'))
    await loadFamily()
    expect(family.status).toBe('error')
    getMyFamily.mockResolvedValue(FAMILY)
    await loadFamily()
    expect(family.status).toBe('ready')
  })

  it('un autre compte ne voit pas la famille du précédent', async () => {
    login('d')
    getMyFamily.mockResolvedValue(FAMILY)
    await loadFamily()
    login('e')
    getMyFamily.mockRejectedValue(new ApiError(404, '', 'no_family'))
    await loadFamily()
    expect(family.data).toBeNull()
    expect(family.status).toBe('none')
  })

  it('une réponse tardive pour l’ancien compte est ignorée', async () => {
    login('f')
    let resolve!: (v: unknown) => void
    getMyFamily.mockReturnValue(new Promise((r) => { resolve = r }))
    const first = loadFamily()
    login('g')
    getMyFamily.mockRejectedValue(new ApiError(404, '', 'no_family'))
    await loadFamily()
    resolve(FAMILY)
    await first
    expect(family.status).toBe('none')
    expect(family.data).toBeNull()
  })
})
