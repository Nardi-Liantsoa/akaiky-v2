import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChildren = vi.fn()
vi.mock('../api/children', () => ({ listChildren: () => listChildren() }))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })

const { auth } = await import('./auth')
const { family } = await import('./family')
const { children, loadChildren, selectChild, selectedChild, dropChild, upsertChild } = await import('./children')
const inFamily = (id: string) => { family.data = { id, name: id, role: 'owner', members: [] }; family.status = 'ready' }

const A = { id: 'a', firstName: 'Fy', avatarColor: 'orange' as const, createdAt: '', parentCodeSetAt: null }
const B = { id: 'b', firstName: 'Tiana', avatarColor: 'blue' as const, createdAt: '', parentCodeSetAt: null }
const login = (id: string, fam = 'f1') => { auth.user = { id, email: `${id}@x.fr`, name: id, is_admin: false }; inFamily(fam) }

describe('enfants de la session', () => {
  beforeEach(() => { listChildren.mockReset(); store.clear(); auth.user = null })

  it('premier enfant sélectionné par défaut, sans rien écrire', async () => {
    login('u1')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    expect(selectedChild()?.id).toBe('a')
    expect(store.size).toBe(0)
  })

  it('sélection retenue et retrouvée après un rechargement de la page', async () => {
    login('u2')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    selectChild('b')
    expect(store.get('akaiky-v2.child.u2')).toBe('b')
    auth.user = null; login('u2') // nouvelle session : état vidé, comme après un rechargement
    await loadChildren()
    expect(selectedChild()?.id).toBe('b')
    selectChild('a')
    expect(store.size).toBe(0)
  })

  it('valeur retenue inconnue ou enfant retiré : retour au premier', async () => {
    login('u3')
    store.set('akaiky-v2.child.u3', 'disparu')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    expect(selectedChild()?.id).toBe('a')
    selectChild('inconnu')
    expect(children.selectedId).toBe('a')
  })

  it('autre famille pour le même compte : liste vidée et rechargée', async () => {
    login('u6', 'fA')
    listChildren.mockResolvedValue([A])
    await loadChildren()
    inFamily('fB')
    expect(children.items).toEqual([])
    listChildren.mockResolvedValue([B])
    await loadChildren()
    expect(children.items.map((c) => c.id)).toEqual(['b'])
  })

  it('sélection retenue par compte : un autre compte de l’appareil ne la reprend pas', async () => {
    login('u7')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    selectChild('b')
    login('u8')
    await loadChildren()
    expect(selectedChild()?.id).toBe('a')
  })

  it('changement de compte : liste et sélection vidées aussitôt', async () => {
    login('u4')
    listChildren.mockResolvedValue([A])
    await loadChildren()
    login('u5')
    expect(children.items).toEqual([])
    expect(children.selectedId).toBeNull()
  })

  it('retrait de l’enfant sélectionné : sélection retenue oubliée, retour au premier', async () => {
    login('u9')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    selectChild('b')
    dropChild('b')
    expect(store.has('akaiky-v2.child.u9')).toBe(false)
    expect(selectedChild()?.id).toBe('a')
    upsertChild({ ...A, firstName: 'Fyfy' })
    expect(selectedChild()?.firstName).toBe('Fyfy')
  })

  it('appels ordinaires simultanés : un seul chargement ; un rechargement forcé repart d’une requête neuve', async () => {
    login('u10')
    listChildren.mockResolvedValue([A])
    await Promise.all([loadChildren(), loadChildren()])
    expect(listChildren).toHaveBeenCalledTimes(1)
    await Promise.all([loadChildren(true), loadChildren(true)])
    expect(listChildren).toHaveBeenCalledTimes(3)
  })

  it('liste demandée avant un retrait : ignorée et redemandée, le retrait n’est pas défait', async () => {
    login('u11')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    let resolveOld!: (v: unknown) => void
    listChildren.mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
    const old = loadChildren(true)
    listChildren.mockResolvedValue([A])
    dropChild('b')
    resolveOld([A, B])
    await old
    expect(children.items.map((c) => c.id)).toEqual(['a'])
    // Liste déjà connue : pas de requête de plus (l'accueil relit à son arrivée).
    expect(listChildren).toHaveBeenCalledTimes(2)
  })

  it('session expirée (401) : déconnexion, pas une erreur à réessayer', async () => {
    login('u12')
    const { ApiError } = await import('../api/http')
    listChildren.mockRejectedValue(new ApiError(401, 'Connexion requise.'))
    await loadChildren()
    expect(auth.user).toBeNull()
    expect(children.status).toBe('unknown')
  })
})
