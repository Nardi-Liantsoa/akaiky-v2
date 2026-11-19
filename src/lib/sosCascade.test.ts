import { describe, expect, it } from 'vitest'
import shared from '../../tests/fixtures/sos-cascade-cases.json'
import { MESSAGES as messages } from '../i18n/messages'
import { buildSosPlan, confirmNativeSos, fillSms, gsmLength, sosInProgress, sosStartOutcome, SOS_CANCEL_WAIT_MS, SOS_CONFIRM_MS, startCascade, stepCascade, type CascadeAction, type CascadeEvent, type SosContact, type SosPlan, type SosRunStatus } from './sosCascade'

const contacts = shared.contacts as Record<string, SosContact>
const label = (plan: SosPlan, a: CascadeAction) =>
  a.type === 'call' ? `call:${plan.calls[a.index].name}${a.timeout ? '' : ':noTimeout'}` : a.type

describe('cascade SOS : cas partagés avec le service natif', () => {
  it('assez de cas', () => expect(shared.cases.length).toBeGreaterThan(10))
  for (const c of shared.cases) {
    it(c.name, () => {
      const plan = buildSosPlan(c.contacts.map((n) => contacts[n]), '117', c.inSchool)
      expect(plan.sms.map((s) => s.name)).toEqual(c.sms)
      expect(plan.calls.map((s) => s.name)).toEqual(c.calls)
      let step = startCascade(plan)
      const trace = step.actions.map((a) => label(plan, a))
      for (const e of c.events as CascadeEvent[]) {
        step = stepCascade(plan, step.state, e)
        trace.push(...step.actions.map((a) => label(plan, a)))
      }
      expect(trace).toEqual(c.trace)
      expect(step.state.status).toBe(c.status)
    })
  }
})

describe('nouveau SOS : cas partagés avec le service natif', () => {
  it('assez de cas', () => expect(shared.runs.length).toBeGreaterThanOrEqual(5))
  for (const r of shared.runs) {
    it(r.name, () => {
      expect(sosInProgress({ active: r.active, finished: 'finished' in r ? r.finished : false, status: r.status as SosRunStatus })).toBe(r.inProgress)
    })
  }
})

describe('lancement du SOS : jamais d’échec muet', () => {
  const pending = { active: true, pending: true, status: 'starting' as const }
  const live = { active: true, status: 'starting' as const }
  it('le service a pris le SOS : en marche', () => {
    expect(sosStartOutcome({ started: true }, live, 100)).toBe('running')
  })
  it('lancé, état provisoire du plugin seul : on attend, puis repli passé 5 s', () => {
    expect(sosStartOutcome({ started: true }, pending, 0)).toBe('wait')
    expect(sosStartOutcome({ started: true }, pending, SOS_CONFIRM_MS - 1)).toBe('wait')
    expect(sosStartOutcome({ started: true }, pending, SOS_CONFIRM_MS)).toBe('fallback')
    expect(sosStartOutcome({ started: true }, null, SOS_CONFIRM_MS)).toBe('fallback')
  })
  it('lancé, état d’un SOS précédent fini : pas pris pour le nouveau', () => {
    expect(sosStartOutcome({ started: true }, { active: false, status: 'answered' }, 0)).toBe('wait')
    expect(sosStartOutcome({ started: true }, { active: false, status: 'answered' }, SOS_CONFIRM_MS)).toBe('fallback')
  })
  it('service impossible (premier plan refusé) : repli tout de suite', () => {
    expect(sosStartOutcome({ started: true }, { active: false, status: 'failed' }, 0)).toBe('fallback')
    expect(sosStartOutcome({ started: false }, { active: false, status: 'failed' }, 0)).toBe('fallback')
  })
  it('déjà en cours : on montre celui-là ; « already » sans SOS en cours : repli', () => {
    expect(sosStartOutcome({ started: false, already: true }, { active: true, status: 'calling' }, 0)).toBe('running')
    expect(sosStartOutcome({ started: false, already: true }, { active: true, status: 'answered' }, 0)).toBe('fallback')
    expect(sosStartOutcome({ started: false, already: true }, null, 0)).toBe('fallback')
  })
  it('plugin absent ou refus : repli', () => {
    expect(sosStartOutcome(null, null, 0)).toBe('fallback')
    expect(sosStartOutcome({ started: false }, live, 0)).toBe('fallback')
  })
})

describe('repli du SOS natif : le service lâche d’abord le SOS', () => {
  type S = { active: boolean, pending?: boolean, status?: SosRunStatus }
  // Horloge simulée : sleep avance le temps, aucune vraie attente.
  function deps(opts: { start: Awaited<ReturnType<Parameters<typeof confirmNativeSos<S>>[0]['start']>>, states: (now: number) => S | null, cancel?: () => Promise<unknown> }) {
    let now = 0
    const log: string[] = []
    return {
      log,
      d: {
        start: async () => opts.start,
        state: async () => opts.states(now),
        cancel: async (o: { runId: string, fallback: true }) => { log.push(`cancel:${o.runId}:${o.fallback}`); return opts.cancel?.() },
        onState: () => {},
        now: () => now,
        sleep: async (ms: number) => { log.push(`sleep:${ms}`); now += ms }
      }
    }
  }
  const pending: S = { active: true, pending: true, status: 'starting' }
  it('jamais confirmé : cancel(runId, fallback) attendu AVANT le repli', async () => {
    const { log, d } = deps({ start: { started: true, runId: 'r1' }, states: () => pending })
    const out = await confirmNativeSos(d)
    expect(out).toBe('fallback')
    // Toutes les attentes de confirmation, puis cancel (avant que le repli soit rendu).
    expect(log.filter((l) => l === 'sleep:500').length).toBe(SOS_CONFIRM_MS / 500)
    expect(log.indexOf('cancel:r1:true')).toBe(log.lastIndexOf('sleep:500') + 1)
  })
  it('cancel qui ne répond pas : repli après une attente courte', async () => {
    const { log, d } = deps({ start: { started: true, runId: 'r2' }, states: () => pending, cancel: () => new Promise(() => {}) })
    expect(await confirmNativeSos(d)).toBe('fallback')
    expect(log.slice(-2)).toEqual(['cancel:r2:true', `sleep:${SOS_CANCEL_WAIT_MS}`])
  })
  it('cancel qui échoue : repli quand même', async () => {
    const { d } = deps({ start: { started: true, runId: 'r3' }, states: () => pending, cancel: () => Promise.reject(new Error('x')) })
    expect(await confirmNativeSos(d)).toBe('fallback')
  })
  it('confirmé par le service : en marche, aucun cancel', async () => {
    const { log, d } = deps({ start: { started: true, runId: 'r4' }, states: (now) => now >= 1000 ? { active: true, status: 'calling' } : pending })
    expect(await confirmNativeSos(d)).toBe('running')
    expect(log.some((l) => l.startsWith('cancel'))).toBe(false)
  })
  it('refusé sans SOS en cours, ou plugin absent : repli sans cancel', async () => {
    const a = deps({ start: { started: false }, states: () => null })
    expect(await confirmNativeSos(a.d)).toBe('fallback')
    expect(a.log.some((l) => l.startsWith('cancel'))).toBe(false)
    const b = deps({ start: null, states: () => null })
    expect(await confirmNativeSos(b.d)).toBe('fallback')
  })
  it('« already » avec un lancement pas encore confirmé : attendu, jamais montré en cours', () => {
    expect(sosStartOutcome({ started: false, already: true }, pending, 0)).toBe('wait')
    expect(sosStartOutcome({ started: false, already: true }, pending, SOS_CONFIRM_MS)).toBe('fallback')
  })
  it('SOS interrompu : jamais en marche', () => {
    expect(sosStartOutcome({ started: false, already: true }, { active: false, status: 'interrupted' }, 0)).toBe('fallback')
    expect(sosStartOutcome({ started: true }, { active: false, status: 'interrupted' }, 0)).toBe('fallback')
  })
})

describe('cascade SOS : règles', () => {
  const plan = buildSosPlan([contacts.maman, contacts.papa], '117', false)
  it('numéros et secours portés par le plan', () => {
    expect(plan.calls.map((c) => c.number)).toEqual(['+261341111111', '+261343333333'])
    expect(plan.emergency).toBe('117')
  })
  it('un état terminé ignore tout événement', () => {
    const answered = stepCascade(plan, startCascade(plan).state, { type: 'ended', connectedS: 30, endedByUs: false })
    expect(answered.state.status).toBe('answered')
    for (const e of [{ type: 'cancel' }, { type: 'failed' }, { type: 'incoming' }, { type: 'ring', fromContact: true }] as CascadeEvent[]) {
      expect(stepCascade(plan, answered.state, e)).toEqual({ state: answered.state, actions: [] })
    }
  })
  it('seuil de 8 s inclus', () => {
    expect(stepCascade(plan, startCascade(plan).state, { type: 'ended', connectedS: 8, endedByUs: false }).state.status).toBe('answered')
  })
})

describe('SMS du SOS', () => {
  const position = { lat: -18.879191, lon: -147.507903, acc: 1234.4, time: '23:59' }
  for (const lang of ['mg', 'fr', 'en'] as const) {
    it(`${lang} : alphabet GSM 7 bits, 160 caractères au plus avec un prénom long`, () => {
      const t = messages[lang].child.sos
      const name = 'Fanomezantsoa Mihaja'
      const withPos = fillSms(t.smsWith(name), position)
      for (const text of [withPos, t.smsWithout(name)]) {
        const n = gsmLength(text)
        expect(n, text).not.toBeNull()
        expect(n!, text).toBeLessThanOrEqual(160)
      }
      expect(withPos).toContain('geo:-18.87919,-147.50790')
      expect(withPos).toContain('1234 m')
      expect(withPos).toContain('23:59')
    })
  }
  it('un caractère hors GSM 7 bits est repéré', () => {
    expect(gsmLength('±')).toBeNull()
    expect(gsmLength('’')).toBeNull()
    expect(gsmLength('a~')).toBe(3)
  })
})
