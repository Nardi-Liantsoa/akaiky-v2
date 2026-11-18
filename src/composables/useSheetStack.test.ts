import { describe, expect, it, vi } from 'vitest'
import { closeTopSheet, openSheets, pushSheet } from './useSheetStack'

// Ordre de la pile ; Échap, retour Android et défilement bloqué sont vérifiés par l'e2e.
describe('useSheetStack', () => {
  it('la dernière feuille ouverte se ferme en premier ; fermer deux fois ne retire rien de plus', () => {
    const a = vi.fn(), b = vi.fn()
    const popA = pushSheet(a)
    const popB = pushSheet(b)
    expect(openSheets()).toBe(2)
    expect(closeTopSheet()).toBe(true)
    expect(b).toHaveBeenCalled()
    expect(a).not.toHaveBeenCalled()
    popB()
    popB()
    expect(openSheets()).toBe(1)
    popA()
    expect(openSheets()).toBe(0)
    expect(closeTopSheet()).toBe(false)
  })
})
