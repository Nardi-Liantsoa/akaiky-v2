import { describe, expect, it } from 'vitest'
import { safeNext } from './nextPath'

describe('safeNext', () => {
  it('accepte les routes internes', () => {
    expect(safeNext('/espace')).toBe('/espace')
    expect(safeNext('/securite')).toBe('/securite')
    expect(safeNext('/admin?onglet=audit')).toBe('/admin?onglet=audit')
    expect(safeNext('/invitation')).toBe('/invitation')
    expect(safeNext('/espace/famille')).toBe('/espace/famille')
  })
  it('refuse tout ce qui peut sortir du site', () => {
    for (const v of ['//evil.example', 'https://evil.example', '/\\evil.example', '/espace\\..\\x', 'javascript:alert(1)', '/autre', '/invitation#invite=x', '/invitations', '', null, ['/espace']]) {
      expect(safeNext(v)).toBe('/espace')
    }
  })
})
