import { describe, expect, it } from 'vitest'
import { sosPlan } from './sos'

describe('sosPlan', () => {
  it('premier contact de l’ordre SOS, puis le numéro d’urgence', () => {
    const contacts = [{ phone: '+2613302', position: 2 }, { phone: '+2613401', position: 1 }]
    expect(sosPlan(contacts, '117')).toEqual([{ kind: 'contact', number: '+2613401' }, { kind: 'emergency', number: '117' }])
  })
  it('sans contact : le numéro d’urgence seul', () => {
    expect(sosPlan([], '112')).toEqual([{ kind: 'emergency', number: '112' }])
  })
})
