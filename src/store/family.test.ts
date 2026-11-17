import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/http'

// Frontière simulée : l'appel réseau. Le reste (état, transitions) est le vrai code.
const getMyFamily = vi.fn()
vi.mock('../api/families', () => ({ getMyFamily: () => getMyFamily() }))
const replace = vi.fn()
vi.mock('../router', () => ({ router: { replace, currentRoute: { value: { fullPath: '/espace/famille' } } } }))

const { auth } = await import('./auth')
const { family, loadFamily, canManage, setFamilyName } = await import('./family')

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

  it('rechargement forcé : la réponse la plus récente gagne, sans repasser par « loading »', async () => {
    login('h')
    getMyFamily.mockResolvedValue(FAMILY)
    await loadFamily()
    let resolveOld!: (v: unknown) => void
    getMyFamily.mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
    const old = loadFamily(true)
    expect(family.status).toBe('ready')
    getMyFamily.mockResolvedValueOnce({ ...FAMILY, name: 'Nouveau' })
    await loadFamily(true)
    resolveOld({ ...FAMILY, name: 'Ancien' })
    await old
    expect(family.data?.name).toBe('Nouveau')
  })

  it('déconnexion : l’état disparaît aussitôt, sans attendre un chargement', async () => {
    login('i')
    getMyFamily.mockRejectedValue(new ApiError(404, '', 'no_family'))
    await loadFamily()
    expect(family.status).toBe('none')
    auth.user = null
    expect(family.status).toBe('unknown')
    login('j')
    expect(family.status).toBe('unknown')
  })

  it('rechargement en échec réseau : la famille connue reste affichée', async () => {
    login('l')
    getMyFamily.mockResolvedValue(FAMILY)
    await loadFamily()
    getMyFamily.mockRejectedValue(new ApiError(0, 'network'))
    await loadFamily(true)
    expect(family.status).toBe('ready')
    expect(family.data?.name).toBe('Rabe')
  })

  it('session expirée (401) : déconnexion et retour à la connexion, pas une panne', async () => {
    login('m')
    getMyFamily.mockRejectedValue(new ApiError(401, 'Connexion requise.'))
    await loadFamily()
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith({ name: 'connexion', query: { next: '/espace/famille' } }))
    expect(auth.user).toBeNull()
    expect(family.status).toBe('unknown')
  })

  it('renommage appliqué localement', async () => {
    login('k')
    getMyFamily.mockResolvedValue(FAMILY)
    await loadFamily()
    setFamilyName('Andria')
    expect(family.data?.name).toBe('Andria')
  })
})
