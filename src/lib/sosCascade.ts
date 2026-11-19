// SOS hors ligne (NAR-151) : plan (qui reçoit le SMS, qui est appelé, dans quel ordre)
// et cascade d'appels, en machine à états pure. Le service natif applique la même règle
// (SosCascade.kt), cas partagés dans tests/fixtures/sos-cascade-cases.json : un écart entre les
// deux est une erreur de test, pas une différence de comportement.
//
// Android ne dit pas quand un appel SORTANT est décroché (sans être l'app téléphone par
// défaut, on ne voit que « en ligne » dès la composition, puis « raccroché »). La durée
// connectée n'est connue qu'après la fin de l'appel, par le journal d'appels. D'où :
// - au-delà de NO_ANSWER_S en ligne, l'appel est coupé (on ne sait pas s'il sonne encore) ;
// - décroché = au moins ANSWERED_MIN_S connectées d'après le journal ;
// - décroché PUIS coupé par nous : le même contact est rappelé une fois, sans délai de
//   coupure (la conversation reprend), au lieu de passer au suivant.

export const ANSWERED_MIN_S = 8
export const NO_ANSWER_S = 25
export const DIAL_TIMEOUT_S = 10
export const LOCATION_TIMEOUT_S = 10
export const SIREN_MAX_S = 120

export interface SosContact { id: string, name: string, phone: string, position: number, parent?: boolean }
export interface SosTarget { id: string, name: string, number: string }
export interface SosPlan { sms: SosTarget[], calls: SosTarget[], emergency: string }

const target = (c: SosContact): SosTarget => ({ id: c.id, name: c.name, number: c.phone })
const byPosition = (a: SosContact, b: SosContact) => a.position - b.position

// SMS : les contacts liés à un parent (owner, manager), sinon tous. Appels : les parents
// d'abord, puis les autres, chacun dans l'ordre choisi par le parent ; secours en dernier.
// Pendant une plage « école » : les seuls parents sont appelés, puis les secours ; le SMS
// suit la même règle qu'en dehors (un SMS ne fait sonner personne contre la règle).
export function buildSosPlan(contacts: readonly SosContact[], emergency: string, inSchool: boolean): SosPlan {
  const sorted = [...contacts].sort(byPosition)
  const parents = sorted.filter((c) => c.parent === true)
  const others = sorted.filter((c) => c.parent !== true)
  const sms = parents.length ? parents : sorted
  const calls = inSchool ? parents : [...parents, ...others]
  return { sms: sms.map(target), calls: calls.map(target), emergency }
}

// calling : un appel du plan est en cours (index) ; emergency : liste épuisée, composeur
// des secours ouvert (la sirène continue) ; answered et cancelled : fin.
export type CascadeStatus = 'calling' | 'answered' | 'cancelled' | 'emergency'
export interface CascadeState { status: CascadeStatus, index: number, redial: boolean }
export type CascadeEvent =
  | { type: 'ended', connectedS: number, endedByUs: boolean }
  | { type: 'failed' }
  | { type: 'cancel' }
  | { type: 'incoming' }
  // Le téléphone sonne pendant le SOS : fromContact = numéro joignable reconnu par le natif
  // (numéro lu, ou laissé sonner par le filtre à l'instant). Un inconnu est ignoré.
  | { type: 'ring', fromContact: boolean }
  | { type: 'emergency' }
// call.timeout : couper l'appel après NO_ANSWER_S en ligne (faux pour un rappel).
export type CascadeAction =
  | { type: 'call', index: number, timeout: boolean }
  | { type: 'endCall' }
  | { type: 'dialEmergency' }
  | { type: 'stopSiren' }
export interface CascadeStep { state: CascadeState, actions: CascadeAction[] }

function callAt(plan: SosPlan, index: number): CascadeStep {
  if (index < plan.calls.length) return { state: { status: 'calling', index, redial: false }, actions: [{ type: 'call', index, timeout: true }] }
  return { state: { status: 'emergency', index: plan.calls.length, redial: false }, actions: [{ type: 'dialEmergency' }] }
}

export const startCascade = (plan: SosPlan): CascadeStep => callAt(plan, 0)

export function stepCascade(plan: SosPlan, state: CascadeState, event: CascadeEvent): CascadeStep {
  const done = { state, actions: [] }
  if (state.status === 'answered' || state.status === 'cancelled') return done
  switch (event.type) {
    case 'cancel':
      return { state: { ...state, status: 'cancelled' }, actions: state.status === 'calling' ? [{ type: 'endCall' }, { type: 'stopSiren' }] : [{ type: 'stopSiren' }] }
    // Un contact appelle le téléphone (le filtre ne laisse sonner que lui) : il a vu le
    // SMS, il prend le relais. La sirène s'arrête pour qu'on l'entende.
    case 'incoming':
      return { state: { ...state, status: 'answered', index: -1 }, actions: [{ type: 'stopSiren' }] }
    case 'ring':
      return event.fromContact ? { state: { ...state, status: 'answered', index: -1 }, actions: [{ type: 'stopSiren' }] } : done
    // L'enfant touche « Appeler les secours » : la cascade s'arrête (appel en cours coupé),
    // composeur des secours ouvert ; la sirène continue, comme pour une liste épuisée.
    case 'emergency':
      return { state: { ...state, status: 'emergency' }, actions: state.status === 'calling' ? [{ type: 'endCall' }, { type: 'dialEmergency' }] : [{ type: 'dialEmergency' }] }
    case 'failed':
      return state.status === 'calling' ? callAt(plan, state.index + 1) : done
    case 'ended': {
      if (state.status !== 'calling') return done
      if (event.connectedS >= ANSWERED_MIN_S) {
        if (event.endedByUs && !state.redial) return { state: { ...state, redial: true }, actions: [{ type: 'call', index: state.index, timeout: false }] }
        return { state: { ...state, status: 'answered' }, actions: [{ type: 'stopSiren' }] }
      }
      return callAt(plan, state.index + 1)
    }
  }
}

// Un SOS en cours (position et SMS, appels, secours) refuse un nouveau départ ; répondu,
// annulé ou fini, un nouveau SOS repart de zéro. Même règle que SosCascade.inProgress.
export type SosRunStatus = 'starting' | CascadeStatus | 'failed' | 'interrupted'
export function sosInProgress(s: { active: boolean, finished?: boolean, status?: SosRunStatus } | null | undefined): boolean {
  if (!s || !s.active || s.finished === true) return false
  return s.status === undefined || s.status === 'starting' || s.status === 'calling' || s.status === 'emergency'
}

// Délai pour que le service natif confirme le SOS (son premier état) : au-delà, ou s'il
// dit « failed », l'écran passe à l'ancien SOS (appel direct) et l'affiche.
export const SOS_CONFIRM_MS = 5000

// Réponse de AkaikySos.start et dernier état connu → suite à donner par l'écran :
// running = le service a pris le SOS ; wait = lancé, son état n'est pas encore venu ;
// fallback = rien ne tourne (refus, échec, interrompu ou délai dépassé) : appel direct, erreur
// visible. « already » avec un lancement pas encore confirmé : on attend lui aussi (jamais un SOS
// montré en cours qui ne tourne pas).
export type SosStartOutcome = 'running' | 'wait' | 'fallback'
export function sosStartOutcome(
  res: { started: boolean, already?: boolean } | null,
  state: { active: boolean, pending?: boolean, status?: SosRunStatus } | null | undefined,
  elapsedMs: number
): SosStartOutcome {
  if (state?.status === 'failed' || state?.status === 'interrupted') return 'fallback'
  if (!res || (!res.started && res.already !== true)) return 'fallback'
  if (state?.active && state.pending !== true) return res.started || sosInProgress(state) ? 'running' : 'fallback'
  if (res.started || state?.pending === true) return elapsedMs < SOS_CONFIRM_MS ? 'wait' : 'fallback'
  return 'fallback'
}

// Repli : le service est d'abord prié de lâcher ce SOS (AkaikySos.cancel avec runId et
// fallback), attendu SOS_CANCEL_WAIT_MS au plus, puis seulement l'appel direct : jamais deux
// SOS à la fois.
export const SOS_CANCEL_WAIT_MS = 1500
export interface NativeSosDeps<S extends { active: boolean, pending?: boolean, status?: SosRunStatus }> {
  start: () => Promise<{ started: boolean, already?: boolean, runId?: string, state?: S } | null>
  state: () => Promise<S | null>
  cancel: (options: { runId: string, fallback: true }) => Promise<unknown>
  onState: (state: S) => void
  now: () => number
  sleep: (ms: number) => Promise<void>
}
export async function confirmNativeSos<S extends { active: boolean, pending?: boolean, status?: SosRunStatus }>(
  deps: NativeSosDeps<S>
): Promise<'running' | 'fallback'> {
  const t0 = deps.now()
  const res = await deps.start().catch(() => null)
  if (res?.state) deps.onState(res.state)
  // Lancé ne veut pas dire en marche : on attend le premier état du service (5 s au plus).
  let outcome = sosStartOutcome(res, res?.state ?? await deps.state().catch(() => null), 0)
  while (outcome === 'wait') {
    await deps.sleep(500)
    outcome = sosStartOutcome(res, await deps.state().catch(() => null), deps.now() - t0)
  }
  if (outcome === 'running') return 'running'
  if (res?.started && res.runId) {
    const runId = res.runId
    const cancelled = (async () => deps.cancel({ runId, fallback: true }))().catch(() => {})
    await Promise.race([cancelled, deps.sleep(SOS_CANCEL_WAIT_MS)])
  }
  return 'fallback'
}

// Caractères de l'alphabet GSM 7 bits (table de base, puis extension comptée double) :
// un SMS qui n'en sort pas tient en 160 caractères, sinon 70 (UCS-2).
const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM_EXT = '^{}\\[~]|€\f'
export function gsmLength(text: string): number | null {
  let n = 0
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) n += 1
    else if (GSM_EXT.includes(ch)) n += 2
    else return null
  }
  return n
}

// Texte du SMS : modèle traduit (prénom déjà posé), position remplie ici comme par le
// natif : {lat}, {lon} (5 décimales, ≈ 1 m), {acc} (mètres), {time} (HH:MM).
export function fillSms(template: string, p: { lat: number, lon: number, acc: number, time: string }): string {
  return template.replace('{lat}', p.lat.toFixed(5)).replace('{lon}', p.lon.toFixed(5)).replace('{acc}', String(Math.round(p.acc))).replace('{time}', p.time)
}
