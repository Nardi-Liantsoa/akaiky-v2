import { describe, expect, it } from 'vitest'
import { AVATAR_COLORS, colorToken, initial, leastUsedColor } from './avatar'

describe('avatar', () => {
  it('initiale : premier caractère visible, en majuscule', () => {
    expect(initial('fy')).toBe('F')
    expect(initial('  élodie')).toBe('É')
    expect(initial('👨‍👩‍👧 Rabe')).toBe('👨‍👩‍👧')
    expect(initial('   ')).toBe('')
  })
  it('couleurs : liste fermée, chacune liée à un jeton', () => {
    for (const c of AVATAR_COLORS) expect(colorToken(c)).toMatch(/^var\(--[a-z-]+\)$/)
    expect(new Set(AVATAR_COLORS.map(colorToken)).size).toBe(AVATAR_COLORS.length)
  })
})

describe('leastUsedColor', () => {
  it('propose la première couleur quand rien n’est pris', () => {
    expect(leastUsedColor([])).toBe('orange')
  })
  it('propose la moins portée, la première de la liste à égalité', () => {
    expect(leastUsedColor(['orange'])).toBe('blue')
    expect(leastUsedColor(['orange', 'blue', 'violet', 'green', 'yellow', 'orange'])).toBe('blue')
    expect(leastUsedColor(['orange', 'orange', 'blue', null, 'inconnue'])).toBe('violet')
  })
})
