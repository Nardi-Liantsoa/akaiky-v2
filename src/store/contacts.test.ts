import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/http'

const listContacts = vi.fn()
vi.mock('../api/contacts', () => ({ listContacts: (id: string) => listContacts(id) }))

const { auth } = await import('./auth')
const { family } = await import('./family')
const { contacts, loadContacts } = await import('./contacts')

const C = (id: string, childId: string) => ({ id, childId, name: id, phone: '+261341234567', position: 1, avatarColor: 'orange' as const, memberUserId: null, memberRole: null })
const login = (id: string, fam = 'f1') => { auth.user = { id, email: `${id}@x.fr`, name: id, is_admin: false }; family.data = { id: fam, name: fam, role: 'owner', members: [] } }

describe('contacts de l’enfant affiché', () => {
  beforeEach(() => { listContacts.mockReset(); auth.user = null })

  it('chargés pour un enfant ; un autre enfant repart de zéro', async () => {
    login('u1')
    listContacts.mockResolvedValue({ version: 3, max: 6, contacts: [C('a', 'k1')] })
    await loadContacts('k1')
    expect(contacts.items.map((c) => c.id)).toEqual(['a'])
    expect(contacts.version).toBe(3)
    let resolve!: (v: unknown) => void
    listContacts.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const pending = loadContacts('k2')
    expect(contacts.items).toEqual([])
    expect(contacts.childId).toBe('k2')
    resolve({ version: 1, max: 6, contacts: [C('b', 'k2')] })
    await pending
    expect(contacts.items.map((c) => c.id)).toEqual(['b'])
  })

  it('réponse tardive pour l’enfant précédent : ignorée', async () => {
    login('u2')
    let resolveOld!: (v: unknown) => void
    listContacts.mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
    const old = loadContacts('k1')
    listContacts.mockResolvedValueOnce({ version: 1, max: 6, contacts: [C('b', 'k2')] })
    await loadContacts('k2')
    resolveOld({ version: 9, max: 6, contacts: [C('a', 'k1')] })
    await old
    expect(contacts.items.map((c) => c.id)).toEqual(['b'])
  })

  it('changement de compte : liste vidée aussitôt ; 401 : déconnexion', async () => {
    login('u3')
    listContacts.mockResolvedValue({ version: 1, max: 6, contacts: [C('a', 'k1')] })
    await loadContacts('k1')
    login('u4')
    expect(contacts.items).toEqual([])
    listContacts.mockRejectedValue(new ApiError(401, ''))
    await loadContacts('k1')
    expect(auth.user).toBeNull()
  })
})
