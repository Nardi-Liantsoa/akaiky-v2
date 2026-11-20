import { describe, expect, it } from 'vitest'
import { MESSAGES } from '../i18n/messages'
import { appsSummary, schedulesSummary, SETTINGS_SECTIONS, sectionTitle, sosSummary, templatesSummary } from './settingsSections'

const fr = MESSAGES.fr
const slot = (label: string, days: number, startMin: number, endMin: number, enabled = true) =>
  ({ id: label, label, days, startMin, endMin, enabled })

describe('résumés de Réglages', () => {
  it('six sections, dans l’ordre de l’ancienne page, chacune titrée comme sa carte', () => {
    expect(SETTINGS_SECTIONS.map((s) => sectionTitle(s.key, fr)))
      .toEqual(['Contacts autorisés', 'Applications autorisées', 'Code parent', 'Plages horaires', 'SOS', 'Messages rapides'])
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.route)).size).toBe(6)
  })

  it('applications : nombre et noms ; aucune, ou liste du téléphone pas encore reçue', () => {
    const inventory = [{ package: 'a', label: 'Photo', icon: null, allowed: true }]
    expect(appsSummary({ max: 4, inventory, allowed: [{ package: 'a', label: 'Photo', position: 1 }, { package: 'b', label: 'Calcul', position: 2 }] }, fr))
      .toBe('2 sur 4 · Photo, Calcul')
    expect(appsSummary({ max: 4, inventory, allowed: [] }, fr)).toBe('Aucune application autorisée')
    expect(appsSummary({ max: 4, inventory: [], allowed: [] }, fr)).toBe('Liste du téléphone pas encore reçue')
  })

  it('plages : la première active par heure de début, puis le nombre des autres actives', () => {
    expect(schedulesSummary([], fr)).toBe('Aucune plage')
    expect(schedulesSummary([slot('École', 0b0011111, 480, 960)], fr)).toBe('École · Lun–Ven 8:00–16:00')
    expect(schedulesSummary([slot('Soir', 0b1111111, 1200, 1320), slot('École', 0b0011111, 480, 960), slot('Sport', 0b0100000, 600, 720, false)], fr))
      .toBe('École · Lun–Ven 8:00–16:00 · +1')
    expect(schedulesSummary([slot('École', 1, 480, 960, false)], fr)).toBe('1 plage, désactivée')
    expect(schedulesSummary([slot('École', 1, 480, 960, false), slot('Sport', 2, 600, 700, false)], fr)).toBe('2 plages, désactivées')
  })

  it('messages rapides : par défaut, ou nombre de textes modifiés', () => {
    const list = (texts: (string | null)[]) => texts.map((text, i) => ({ slot: (i + 1) as 1 | 2 | 3 | 4, text }))
    expect(templatesSummary(list([null, null, null, null]), fr)).toBe('Textes par défaut')
    expect(templatesSummary(list([null, 'Viens', null, null]), fr)).toBe('1 sur 4 personnalisé')
    expect(templatesSummary(list(['A', 'B', null, null]), fr)).toBe('2 sur 4 personnalisés')
  })

  it('SOS : état de la sirène, dans les trois langues', () => {
    expect(sosSummary(false, fr)).toBe('Sirène désactivée')
    expect(sosSummary(true, MESSAGES.en)).toBe('Siren on')
    expect(sosSummary(true, MESSAGES.mg)).toBe('Mandeha ny feo fampitandremana')
  })
})
