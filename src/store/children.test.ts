import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChildren = vi.fn()
vi.mock('../api/children', () => ({ listChildren: () => listChildren() }))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })

const { auth } = await import('./auth')
const { children, loadChildren, selectChild, selectedChild } = await import('./children')

const A = { id: 'a', firstName: 'Fy', avatarColor: 'orange', createdAt: '' }
const B = { id: 'b', firstName: 'Tiana', avatarColor: 'blue', createdAt: '' }
const login = (id: string) => { auth.user = { id, email: `${id}@x.fr`, name: id, is_admin: false } }

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
    expect(store.get('akaiky-v2.child')).toBe('b')
    auth.user = null; login('u2') // nouvelle session : état vidé, comme après un rechargement
    await loadChildren()
    expect(selectedChild()?.id).toBe('b')
    selectChild('a')
    expect(store.size).toBe(0)
  })

  it('valeur retenue inconnue ou enfant retiré : retour au premier', async () => {
    login('u3')
    store.set('akaiky-v2.child', 'disparu')
    listChildren.mockResolvedValue([A, B])
    await loadChildren()
    expect(selectedChild()?.id).toBe('a')
    selectChild('inconnu')
    expect(children.selectedId).toBe('a')
  })

  it('changement de compte : liste et sélection vidées aussitôt', async () => {
    login('u4')
    listChildren.mockResolvedValue([A])
    await loadChildren()
    login('u5')
    expect(children.items).toEqual([])
    expect(children.selectedId).toBeNull()
  })
})
