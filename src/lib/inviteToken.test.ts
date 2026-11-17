import { afterEach, describe, expect, it, vi } from 'vitest'

// Navigateur minimal simulé à la frontière : adresse, historique, sessionStorage.
function browser(hash: string) {
  const store = new Map<string, string>()
  const location = { hash, pathname: '/invitation', search: '' }
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '' })
  vi.stubGlobal('location', location)
  vi.stubGlobal('history', { state: null, replaceState })
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  return { location, replaceState, store }
}

const { takeInviteToken, forgetInviteToken } = await import('./inviteToken')
const TOKEN = 'a'.repeat(43)

describe('jeton d’invitation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lu dans le fragment, retiré de l’adresse, gardé pour l’onglet', () => {
    const b = browser(`#invite=${TOKEN}`)
    expect(takeInviteToken()).toBe(TOKEN)
    expect(b.replaceState).toHaveBeenCalledWith(null, '', '/invitation')
    expect(b.location.hash).toBe('')
    expect(takeInviteToken()).toBe(TOKEN)
    forgetInviteToken()
    expect(takeInviteToken()).toBeNull()
  })

  it('fragment ou valeur gardée invalides : ignorés', () => {
    const b = browser('#invite=<script>')
    expect(takeInviteToken()).toBeNull()
    b.store.set('akaiky-v2.invite', 'trop court')
    expect(takeInviteToken()).toBeNull()
  })
})
