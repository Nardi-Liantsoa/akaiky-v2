import { DeviceError, type SecretStore } from './deviceSession'

// Journal des appels sortants du téléphone de l'enfant (NAR-166).
// 1. Appui sur un contact : appel « en cours » noté (identifiant choisi ici : idempotence).
// 2. Retour au premier plan : durée lue dans le journal d'appels d'Android, l'appel
//    passe dans la file d'envoi.
// 3. Envoi par lots ; hors ligne, la file attend le relevé suivant. Tout est gardé dans
//    le stockage sécurisé (données de mineurs), jamais en localStorage.
export const PENDING_KEY = 'device-calls-pending'
export const QUEUE_KEY = 'device-calls-queue'
const MAX_QUEUE = 500
const BATCH = 50
// Après ce délai sans trace dans le journal d'Android, l'appel part sans durée.
const GIVE_UP_MS = 60 * 60_000

// incoming : appel reçu d'un contact (NAR-145), durée lue dans les appels entrants d'Android.
export interface PendingCall { id: string, contactId: string, name: string, number: string, startedAt: number, incoming?: boolean }
// name et phone : instantané au moment de l'appel (contact retiré ou modifié avant l'envoi).
export interface CallEvent { id: string, kind: 'call_out', contactId: string, name: string, phone: string, startedAt: string, durationS: number | null }
// Sortie du verrou (NAR-168) : par le code saisi sur le téléphone ou à la demande d'un
// parent ; durée accordée en secondes (une sortie refermée plus tôt n'est pas recomptée). Envoyée par la même file que les appels.
export interface UnlockEvent { id: string, kind: 'unlock', source: 'code' | 'remote', startedAt: string, durationS: number }
// Appel reçu d'un contact (NAR-145) ; contactId absent si le contact a été retiré entre-temps.
export interface CallInEvent { id: string, kind: 'call_in', contactId?: string, name?: string, phone: string, startedAt: string, durationS: number | null }
// Appel rejeté sans sonnerie : numéro tel que reçu, absent s'il était masqué.
// contactId, name : contact refusé pendant une plage « école » (NAR-176).
export interface BlockedEvent { id: string, kind: 'call_blocked', phone?: string, contactId?: string, name?: string, startedAt: string }
export type DeviceEvent = CallEvent | UnlockEvent | CallInEvent | BlockedEvent
// Événement noté par le filtre natif (CallPlugin.peekIncoming).
// school : refusé pendant une plage « école » (contact non parent, NAR-176).
export interface ScreenedCall { id: string, kind: 'call_in' | 'call_blocked', phone?: string, startedAt: number, school?: boolean }
export interface CallLogEntry { found: boolean, permission?: boolean, startedAt?: number, durationS?: number }

export interface JournalDeps {
  store: SecretStore
  post(events: DeviceEvent[]): Promise<{ accepted: string[], rejected: string[] }>
  lastOutgoing(number: string, since: number, until?: number, incoming?: boolean): Promise<CallLogEntry>
  now(): number
  uuid(): string
}

async function readList<T>(store: SecretStore, key: string, valid: (v: unknown) => v is T): Promise<T[]> {
  try {
    const raw = await store.get(key)
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}
const isPending = (v: unknown): v is PendingCall => typeof (v as PendingCall)?.id === 'string' && typeof (v as PendingCall).number === 'string'
  && typeof (v as PendingCall).name === 'string' && typeof (v as PendingCall).startedAt === 'number'
const isEvent = (v: unknown): v is DeviceEvent => {
  const e = v as DeviceEvent | null
  if (typeof e?.id !== 'string') return false
  if (e.kind === 'call_out' || e.kind === 'call_in') return typeof e.phone === 'string'
  if (e.kind === 'call_blocked') return e.phone === undefined || typeof e.phone === 'string'
  return e.kind === 'unlock' && (e.source === 'code' || e.source === 'remote') && typeof e.durationS === 'number'
}

// Verrou simple : les opérations d'une même liste s'enchaînent sans course.
function lock() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
}

export function createCallJournal(deps: JournalDeps) {
  // Deux verrous : un appel qui part (liste « en cours ») n'attend jamais un envoi réseau
  // (file) ; aucun verrou n'est tenu pendant la requête réseau elle-même.
  const pendingLock = lock()
  const queueLock = lock()
  const save = (key: string, list: unknown[]) => deps.store.set(key, JSON.stringify(list))
  const append = (events: DeviceEvent[]) => queueLock(async () => {
    if (!events.length) return
    const queue = await readList(deps.store, QUEUE_KEY, isEvent)
    const known = new Set(queue.map((q) => q.id))
    await save(QUEUE_KEY, [...queue, ...events.filter((e) => !known.has(e.id))].slice(-MAX_QUEUE))
  })

  return {
    // Appel sur le point de partir : noté AVANT de céder la main au composeur (l'app peut
    // être suspendue pendant l'appel). Renvoie son identifiant, pour l'annuler s'il échoue.
    started(contact: { id: string, name: string }, number: string): Promise<string> {
      return pendingLock(async () => {
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        const id = deps.uuid()
        pending.push({ id, contactId: contact.id, name: contact.name, number, startedAt: deps.now() })
        await save(PENDING_KEY, pending.slice(-MAX_QUEUE))
        return id
      })
    },

    // Appels vus par le filtre natif (NAR-145) : bloqués → file d'envoi ; reçus d'un
    // contact → « en cours », leur durée sera lue après l'appel. Le contact est retrouvé
    // par son numéro dans la liste du parent (instantané du nom). Renvoie les identifiants
    // gardés, que l'appelant acquitte auprès du natif.
    importScreened(calls: ScreenedCall[], contacts: { id: string, name: string, phone: string }[]): Promise<string[]> {
      return pendingLock(async () => {
        const isValid = (c: ScreenedCall) => typeof c?.id === 'string' && typeof c.startedAt === 'number'
          && (c.kind === 'call_in' ? typeof c.phone === 'string' : c.kind === 'call_blocked')
        const valid = calls.filter(isValid)
        // Contact refusé pendant une plage « école » (NAR-176, marqué par le natif) : nom et
        // contact gardés pour que le parent le reconnaisse (et ne se voie pas proposer de
        // l'« autoriser »). Tout autre refus reste un numéro, même s'il ressemble à un contact.
        const blocked: DeviceEvent[] = valid.filter((c) => c.kind === 'call_blocked').map((c) => {
          const contact = c.school === true && c.phone ? contacts.find((k) => k.phone === c.phone) : undefined
          return {
            id: c.id, kind: 'call_blocked', ...(c.phone ? { phone: c.phone } : {}),
            ...(contact ? { contactId: contact.id, name: contact.name } : {}),
            startedAt: new Date(c.startedAt).toISOString()
          }
        })
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        const known = new Set(pending.map((p) => p.id))
        for (const c of valid) {
          if (c.kind !== 'call_in' || known.has(c.id)) continue
          const contact = contacts.find((k) => k.phone === c.phone)
          pending.push({ id: c.id, contactId: contact?.id ?? '', name: contact?.name ?? '', number: c.phone!, startedAt: c.startedAt, incoming: true })
        }
        const keptPending = pending.slice(-MAX_QUEUE)
        const keptIds = new Set(keptPending.map((p) => p.id))
        // File et « en cours » enregistrées AVANT l'acquittement natif : rien ne se perd.
        await append(blocked)
        await save(PENDING_KEY, keptPending)
        // Acquittés : ce qui est gardé, et ce qui est illisible (sinon relu sans fin).
        return calls.filter((c) => typeof c?.id === 'string' && (!isValid(c) || c.kind === 'call_blocked' || keptIds.has(c.id))).map((c) => c.id)
      })
    },

    // Sortie du verrou : mise directement dans la file (rien à compléter).
    unlocked(source: 'code' | 'remote', minutes: number): Promise<void> {
      return append([{ id: deps.uuid(), kind: 'unlock', source, startedAt: new Date(deps.now()).toISOString(), durationS: Math.round(minutes * 60) }])
    },

    // Appel qui n'est pas parti (refus natif, composeur absent) : rien à journaliser.
    cancel(id: string): Promise<void> {
      return pendingLock(async () => {
        await save(PENDING_KEY, (await readList(deps.store, PENDING_KEY, isPending)).filter((p) => p.id !== id))
      })
    },

    // Durée cherchée dans le journal d'Android pour chaque appel en cours ; renvoie le
    // nombre d'appels encore en attente (Android écrit son journal après la fin de l'appel :
    // l'appelant réessaie plus tard). Fenêtre de chaque appel : de son début (noté juste
    // avant de composer, 2 s d'écart toléré) au début de l'appel suivant au même numéro.
    async complete(): Promise<number> {
      const { resolved, waiting } = await pendingLock(async () => {
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        const resolved: DeviceEvent[] = [], left: PendingCall[] = []
        const ordered = [...pending].sort((a, b) => a.startedAt - b.startedAt)
        for (const [i, p] of ordered.entries()) {
          const next = ordered.slice(i + 1).find((q) => q.number === p.number && !!q.incoming === !!p.incoming)
          const until = next ? next.startedAt : undefined
          const lookup = p.incoming ? deps.lastOutgoing(p.number, p.startedAt - 2_000, until, true) : deps.lastOutgoing(p.number, p.startedAt - 2_000, until)
          const log = await lookup.catch(() => ({ found: false }) as CallLogEntry)
          // Pas encore écrit par Android : on attend (une heure au plus). Permission
          // refusée : inutile d'attendre, l'appel part sans durée.
          if (!log.found && log.permission !== false && deps.now() - p.startedAt < GIVE_UP_MS) { left.push(p); continue }
          const startedAt = new Date(log.found && log.startedAt ? log.startedAt : p.startedAt).toISOString()
          const durationS = log.found && typeof log.durationS === 'number' ? log.durationS : null
          resolved.push(p.incoming
            ? { id: p.id, kind: 'call_in', ...(p.contactId ? { contactId: p.contactId, name: p.name } : {}), phone: p.number, startedAt, durationS }
            : { id: p.id, kind: 'call_out', contactId: p.contactId, name: p.name, phone: p.number, startedAt, durationS })
        }
        // File d'abord, liste « en cours » ensuite : un arrêt entre les deux ne perd rien
        // (au pire un doublon, écarté par l'identifiant).
        await append(resolved)
        if (resolved.length) await save(PENDING_KEY, left)
        return { resolved, waiting: left.length }
      })
      void resolved
      return waiting
    },

    // Envoi par lots. Accepté ou refusé définitivement : retiré de la file. Réseau ou
    // serveur indisponible : la file reste. Session perdue (401) : file vidée.
    async flush(): Promise<void> {
      for (;;) {
        const batch = (await queueLock(() => readList(deps.store, QUEUE_KEY, isEvent))).slice(0, BATCH)
        if (!batch.length) return
        let done: Set<string>
        try {
          const r = await deps.post(batch)
          done = new Set([...r.accepted, ...r.rejected])
        } catch (e) {
          if (e instanceof DeviceError && e.status === 401) { await queueLock(() => save(QUEUE_KEY, [])); return }
          // 4xx du lot entier (format refusé) : abandonné, sinon il bloquerait la file à jamais.
          if (e instanceof DeviceError && e.status >= 400 && e.status < 500 && e.status !== 429) done = new Set(batch.map((b) => b.id))
          else return
        }
        await queueLock(async () => save(QUEUE_KEY, (await readList(deps.store, QUEUE_KEY, isEvent)).filter((q) => !done.has(q.id))))
        if (batch.every((b) => !done.has(b.id))) return
      }
    },

    // Session perdue ou remplacée : rien de gardé.
    async clear(): Promise<void> {
      await pendingLock(() => deps.store.remove(PENDING_KEY).catch(() => {}))
      await queueLock(() => deps.store.remove(QUEUE_KEY).catch(() => {}))
    }
  }
}
