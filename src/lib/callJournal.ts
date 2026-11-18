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

export interface PendingCall { id: string, contactId: string, name: string, number: string, startedAt: number }
// name et phone : instantané au moment de l'appel (contact retiré ou modifié avant l'envoi).
export interface CallEvent { id: string, kind: 'call_out', contactId: string, name: string, phone: string, startedAt: string, durationS: number | null }
export interface CallLogEntry { found: boolean, permission?: boolean, startedAt?: number, durationS?: number }

export interface JournalDeps {
  store: SecretStore
  post(events: CallEvent[]): Promise<{ accepted: string[], rejected: string[] }>
  lastOutgoing(number: string, since: number, until?: number): Promise<CallLogEntry>
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
const isEvent = (v: unknown): v is CallEvent => typeof (v as CallEvent)?.id === 'string' && (v as CallEvent).kind === 'call_out' && typeof (v as CallEvent).phone === 'string'

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
  const append = (events: CallEvent[]) => queueLock(async () => {
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
        const resolved: CallEvent[] = [], left: PendingCall[] = []
        const ordered = [...pending].sort((a, b) => a.startedAt - b.startedAt)
        for (const [i, p] of ordered.entries()) {
          const next = ordered.slice(i + 1).find((q) => q.number === p.number)
          const log = await deps.lastOutgoing(p.number, p.startedAt - 2_000, next ? next.startedAt : undefined).catch(() => ({ found: false }) as CallLogEntry)
          // Pas encore écrit par Android : on attend (une heure au plus). Permission
          // refusée : inutile d'attendre, l'appel part sans durée.
          if (!log.found && log.permission !== false && deps.now() - p.startedAt < GIVE_UP_MS) { left.push(p); continue }
          resolved.push({
            id: p.id, kind: 'call_out', contactId: p.contactId, name: p.name, phone: p.number,
            startedAt: new Date(log.found && log.startedAt ? log.startedAt : p.startedAt).toISOString(),
            durationS: log.found && typeof log.durationS === 'number' ? log.durationS : null
          })
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
