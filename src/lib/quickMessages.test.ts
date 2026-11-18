import { describe, expect, it } from 'vitest'
import { quickText, textLength } from './quickMessages'

describe('quickText (NAR-173)', () => {
  const defaults = ['Je suis arrivé', 'Viens me chercher', 'Je suis en retard', 'Tout va bien']
  it('texte modifié s’il existe, sinon le texte par défaut de l’emplacement', () => {
    expect(quickText(2, defaults, 'Viens à l’école')).toBe('Viens à l’école')
    expect(quickText(2, defaults, null)).toBe('Viens me chercher')
    expect(quickText(4, defaults)).toBe('Tout va bien')
    expect(quickText(1, defaults, '   ')).toBe('Je suis arrivé')
  })
})

describe('textLength (NAR-173)', () => {
  it('compte les caractères comme le serveur (points de code, espaces de bord retirés)', () => {
    expect(textLength('😀'.repeat(40))).toBe(40)
    expect(textLength('  Coucou ')).toBe(6)
  })
})
