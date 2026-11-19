import { describe, expect, it } from 'vitest'
import { canRequestRedirection, incomingFilterOff, outgoingFilterOff } from './callScreening'

describe('callScreening', () => {
  it('appels sortants : l’état réel lu par le natif fait foi', () => {
    // Android 8–9 : pas de rôle, récepteur actif avec la permission.
    expect(outgoingFilterOff({ available: false, held: false, redirectionAvailable: false, outgoingActive: true })).toBe(false)
    // Android 8–9 : permission refusée, rien ne peut être demandé.
    const legacyOff = { available: false, held: false, redirectionAvailable: false, outgoingActive: false }
    expect(outgoingFilterOff(legacyOff)).toBe(true)
    expect(canRequestRedirection(legacyOff)).toBe(false)
    // Android 10+ : rôle absent → inactif et demandable ; détenu → actif.
    const roleMissing = { available: true, held: true, redirectionAvailable: true, redirectionHeld: false, outgoingActive: false }
    expect(outgoingFilterOff(roleMissing)).toBe(true)
    expect(canRequestRedirection(roleMissing)).toBe(true)
    expect(outgoingFilterOff({ available: true, held: true, redirectionAvailable: true, redirectionHeld: true, outgoingActive: true })).toBe(false)
  })

  it('coque plus ancienne sans outgoingActive : état du rôle', () => {
    expect(outgoingFilterOff({ available: true, held: true, redirectionAvailable: true, redirectionHeld: false })).toBe(true)
    expect(outgoingFilterOff({ available: true, held: true })).toBe(false)
    expect(outgoingFilterOff(null)).toBe(false)
  })

  it('appels entrants : rôle de filtrage demandable et absent', () => {
    expect(incomingFilterOff({ available: true, held: false })).toBe(true)
    expect(incomingFilterOff({ available: true, held: true })).toBe(false)
    expect(incomingFilterOff({ available: false, held: false })).toBe(false)
    expect(incomingFilterOff(null)).toBe(false)
  })
})
