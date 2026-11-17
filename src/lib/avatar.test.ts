import { describe, expect, it } from 'vitest'
import { AVATAR_COLORS, colorToken, initial } from './avatar'

describe('avatar', () => {
  it('initiale : premier caractère visible, en majuscule', () => {
    expect(initial('fy')).toBe('F')
    expect(initial('  élodie')).toBe('É')
    expect(initial('👨‍👩‍👧 Rabe')).toBe('👨‍👩‍👧')
    expect(initial('   ')).toBe('?')
  })
  it('couleurs : liste fermée, chacune liée à un jeton', () => {
    for (const c of AVATAR_COLORS) expect(colorToken(c)).toMatch(/^var\(--[a-z-]+\)$/)
    expect(new Set(AVATAR_COLORS.map(colorToken)).size).toBe(AVATAR_COLORS.length)
  })
})
