import { describe, expect, it } from 'vitest'
import { joinNames } from './joinNames'

describe('joinNames', () => {
  it('relie les noms comme une phrase', () => {
    expect(joinNames([], 'et')).toBe('')
    expect(joinNames(['Papa'], 'et')).toBe('Papa')
    expect(joinNames(['Papa', 'Mamie'], 'sy')).toBe('Papa sy Mamie')
    expect(joinNames(['Papa', 'Tonton', 'Mamie'], 'et')).toBe('Papa, Tonton et Mamie')
  })
})
