import { describe, expect, it } from 'vitest'
import { MESSAGES } from '../i18n/messages'
import { lastSeen, phoneStatus, statusLevel } from './childStatus'

const t = MESSAGES.fr
const now = new Date('2026-11-18T12:00:00Z') // 15:00 à Antananarivo
const seen = '2026-11-18T11:05:00Z'

describe('statusLevel', () => {
  it('en ligne, sans alerte : tout va bien', () => {
    expect(statusLevel(seen, [])).toBe('ok')
  })
  it('batterie faible ou carte SIM absente : à vérifier', () => {
    expect(statusLevel(seen, ['battery_low'])).toBe('warn')
    expect(statusLevel(seen, ['sim_absent'])).toBe('warn')
    expect(statusLevel(seen, ['sim_absent', 'battery_low'])).toBe('warn')
  })
  it('silence : ne répond plus, même avec d’autres alertes', () => {
    expect(statusLevel(seen, ['silent'])).toBe('alert')
    expect(statusLevel(seen, ['battery_low', 'silent'])).toBe('alert')
  })
  it('sans téléphone ou date invalide : aucun téléphone, alertes ignorées', () => {
    expect(statusLevel(null, null)).toBe('none')
    expect(statusLevel(null, ['silent'])).toBe('none')
    expect(statusLevel('pas une date', [])).toBe('none')
  })
  it('alertes pas encore lues : niveau inconnu, jamais deviné', () => {
    expect(statusLevel(seen, null)).toBeNull()
  })
})

describe('lastSeen', () => {
  it('aujourd’hui : l’heure ; avant : la date et l’heure (heure de Madagascar)', () => {
    expect(lastSeen(seen, t, 'fr', now)).toBe('vu à 14:05')
    expect(lastSeen('2026-11-16T07:30:00Z', t, 'fr', now)).toBe('vu le 16 novembre à 10:30')
    // Même jour, autre année : jamais « aujourd'hui » ; l'année est donnée.
    expect(lastSeen('2025-11-18T11:05:00Z', t, 'fr', now)).toBe('vu le 18 novembre 2025 à 14:05')
    expect(lastSeen(seen, MESSAGES.mg, 'mg', now)).toBe('hita tamin’ny 14:05')
  })
  it('sans téléphone ou date invalide : rien', () => {
    expect(lastSeen(null, t, 'fr', now)).toBe('')
    expect(lastSeen('pas une date', t, 'fr', now)).toBe('')
  })
})

describe('phoneStatus (sélecteur d’enfant)', () => {
  it('phrase complète ; sans téléphone : aucun téléphone relié', () => {
    expect(phoneStatus(seen, t, 'fr', now)).toBe('Téléphone vu à 14:05')
    expect(phoneStatus('2026-11-16T07:30:00Z', t, 'fr', now)).toBe('Téléphone vu le 16 novembre à 10:30')
    expect(phoneStatus(null, t, 'fr', now)).toBe('Aucun téléphone relié')
    expect(phoneStatus('pas une date', t, 'fr', now)).toBe('Aucun téléphone relié')
  })
})
