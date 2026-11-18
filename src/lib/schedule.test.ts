import { describe, expect, it } from 'vitest'
import { activeWindow, daysSummary, safeTimeZone, visibleContacts, fromTimeInput, toTimeInput, weekMinute, type ScheduleRule } from './schedule'

const TZ = 'Indian/Antananarivo' // UTC+3, sans changement d'heure
// Heure locale de Madagascar → Date. 2026-11-16 est un lundi.
const at = (day: number, hh: number, mm = 0, ss = 0) => new Date(Date.UTC(2026, 10, 16 + day, hh - 3, mm, ss))
const WEEKDAYS = 0b0011111
const school: ScheduleRule = { label: 'École', days: WEEKDAYS, startMin: 8 * 60, endMin: 16 * 60 }

describe('weekMinute', () => {
  it('compte depuis lundi 0:00 dans le fuseau donné', () => {
    expect(weekMinute(at(0, 0), TZ)).toBe(0)
    expect(weekMinute(at(2, 8, 30), TZ)).toBe(2 * 1440 + 510)
    expect(weekMinute(at(6, 23, 59), TZ)).toBe(7 * 1440 - 1)
    // Après-midi : jamais lu en 12 heures.
    expect(weekMinute(at(0, 14, 30), TZ)).toBe(870)
  })
})

describe('activeWindow (NAR-148)', () => {
  it('début et fin à la minute près, fin exclue', () => {
    expect(activeWindow(at(0, 7, 59, 59), [school], TZ)).toBeNull()
    expect(activeWindow(at(0, 8), [school], TZ)).toEqual({ label: 'École', until: at(0, 16) })
    expect(activeWindow(at(0, 15, 59, 30), [school], TZ)?.until).toEqual(at(0, 16))
    expect(activeWindow(at(0, 16), [school], TZ)).toBeNull()
  })

  it('jours exclus : rien le samedi ni le dimanche', () => {
    expect(activeWindow(at(5, 10), [school], TZ)).toBeNull()
    expect(activeWindow(at(6, 10), [school], TZ)).toBeNull()
    expect(activeWindow(at(4, 10), [school], TZ)?.until).toEqual(at(4, 16))
  })

  it('plage qui traverse minuit : commence le jour coché, finit le lendemain', () => {
    const night: ScheduleRule = { label: 'Nuit', days: 1 << 4, startMin: 21 * 60, endMin: 7 * 60 } // vendredi soir
    expect(activeWindow(at(4, 22), [night], TZ)).toEqual({ label: 'Nuit', until: at(5, 7) })
    expect(activeWindow(at(5, 6, 59), [night], TZ)?.until).toEqual(at(5, 7))
    expect(activeWindow(at(5, 7), [night], TZ)).toBeNull()
    // Le jeudi soir n'est pas coché.
    expect(activeWindow(at(3, 22), [night], TZ)).toBeNull()
  })

  it('dimanche soir → lundi matin : passage de semaine', () => {
    const sunday: ScheduleRule = { label: 'Dimanche', days: 1 << 6, startMin: 22 * 60, endMin: 6 * 60 }
    expect(activeWindow(at(0, 5), [sunday], TZ)?.until).toEqual(at(0, 6))
    expect(activeWindow(at(6, 23), [sunday], TZ)?.until).toEqual(at(7, 6))
  })

  it('deux plages qui se chevauchent ou se suivent : une seule fenêtre jusqu’à la dernière fin', () => {
    const club: ScheduleRule = { label: 'Club', days: WEEKDAYS, startMin: 15 * 60, endMin: 17 * 60 + 30 }
    const study: ScheduleRule = { label: 'Étude', days: WEEKDAYS, startMin: 17 * 60 + 30, endMin: 18 * 60 }
    expect(activeWindow(at(1, 9), [school, club, study], TZ)).toEqual({ label: 'École', until: at(1, 18) })
    expect(activeWindow(at(1, 15, 30), [school, club], TZ)).toEqual({ label: 'Club', until: at(1, 17, 30) })
  })

  it('toute la semaine couverte : sans fin', () => {
    const always: ScheduleRule = { label: 'Toujours', days: 127, startMin: 0, endMin: 0 + 1439 }
    const gap: ScheduleRule = { label: 'Minuit', days: 127, startMin: 1439, endMin: 0 }
    expect(activeWindow(at(2, 12), [always, gap], TZ)).toEqual({ label: 'Toujours', until: null })
  })

  it('aucune plage : rien d’actif', () => {
    expect(activeWindow(at(0, 10), [], TZ)).toBeNull()
  })
})

describe('daysSummary, heures', () => {
  const names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
  it('suite de jours, liste, tous les jours', () => {
    expect(daysSummary(0b0011111, names, 'Tous les jours')).toBe('Lun–Ven')
    expect(daysSummary(0b0000101, names, 'Tous les jours')).toBe('Lun, Mer')
    expect(daysSummary(0b1100111, names, 'Tous les jours')).toBe('Lun–Mer, Sam, Dim')
    expect(daysSummary(127, names, 'Tous les jours')).toBe('Tous les jours')
  })
  it('« HH:MM » ⇄ minutes', () => {
    expect(toTimeInput(480)).toBe('08:00')
    expect(fromTimeInput('16:30')).toBe(990)
    expect(fromTimeInput('24:00')).toBeNull()
    expect(fromTimeInput('')).toBeNull()
  })
})

describe('visibleContacts', () => {
  const list = [{ name: 'Maman', parent: true }, { name: 'Mamie', parent: false }, { name: 'Ancien cache' }]
  it('hors plage : tous ; pendant une plage : les seuls parents (un contact sans l’information n’est pas un parent)', () => {
    expect(visibleContacts(list, null).map((c) => c.name)).toEqual(['Maman', 'Mamie', 'Ancien cache'])
    expect(visibleContacts(list, { label: 'École', until: null }).map((c) => c.name)).toEqual(['Maman'])
  })
})

describe('safeTimeZone', () => {
  it('garde un fuseau IANA connu, remplace le reste par Madagascar', () => {
    expect(safeTimeZone('Europe/Paris')).toBe('Europe/Paris')
    expect(safeTimeZone('Madagascar')).toBe('Indian/Antananarivo')
    expect(safeTimeZone(undefined)).toBe('Indian/Antananarivo')
  })
})
