import { describe, expect, it } from 'vitest'
import { MESSAGES } from '../i18n/messages'
import { phoneStatus } from './childStatus'

const t = MESSAGES.fr
const now = new Date('2026-11-18T12:00:00Z') // 15:00 à Antananarivo

describe('phoneStatus', () => {
  it('aujourd’hui : l’heure ; avant : la date et l’heure (heure de Madagascar)', () => {
    expect(phoneStatus('2026-11-18T11:05:00Z', t, 'fr', now)).toBe('Téléphone vu à 14:05')
    expect(phoneStatus('2026-11-16T07:30:00Z', t, 'fr', now)).toBe('Téléphone vu le 16 novembre à 10:30')
    // Même jour, autre année : jamais « aujourd'hui » ; l'année est donnée.
    expect(phoneStatus('2025-11-18T11:05:00Z', t, 'fr', now)).toBe('Téléphone vu le 18 novembre 2025 à 14:05')
  })
  it('sans téléphone relié', () => {
    expect(phoneStatus(null, t, 'fr', now)).toBe('Aucun téléphone relié')
    expect(phoneStatus('pas une date', t, 'fr', now)).toBe('Aucun téléphone relié')
  })
})
