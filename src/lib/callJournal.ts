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

export interface PendingCall { id: string, contactId: string, number: string, startedAt: number }
export interface CallEvent { id: string, kind: 'call_out', contactId: string, startedAt: string, durationS: number | null }
export interface CallLogEntry { found: boolean, startedAt?: number, durationS?: number }

export interface JournalDeps {
  store: SecretStore
  post(events: CallEvent[]): Promise<{ accepted: string[], rejected: string[] }>
  lastOutgoing(number: string, since: number): Promise<CallLogEntry>
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
const isPending = (v: unknown): v is PendingCall => typeof (v as PendingCall)?.id === 'string' && typeof (v as PendingCall).number === 'string' && typeof (v as PendingCall).startedAt === 'number'
const isEvent = (v: unknown): v is CallEvent => typeof (v as CallEvent)?.id === 'string' && (v as CallEvent).kind === 'call_out'

export function createCallJournal(deps: JournalDeps) {
  // Une seule opération à la fois : lecture, modification, écriture des listes sans course.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
  const save = (key: string, list: unknown[]) => deps.store.set(key, JSON.stringify(list))

  return {
    // Appel lancé vers un contact : noté avant de quitter l'app pour le composeur.
    started(contactId: string, number: string): Promise<void> {
      return serial(async () => {
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        pending.push({ id: deps.uuid(), contactId, number, startedAt: deps.now() })
        await save(PENDING_KEY, pending.slice(-MAX_QUEUE))
      })
    },

    // Retour au premier plan : durée cherchée dans le journal d'Android pour chaque appel en cours.
    complete(): Promise<void> {
      return serial(async () => {
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        if (!pending.length) return
        const queue = await readList(deps.store, QUEUE_KEY, isEvent)
        const left: PendingCall[] = []
        for (const p of pending) {
          const log = await deps.lastOutgoing(p.number, p.startedAt - 10_000).catch(() => ({ found: false }) as CallLogEntry)
          if (!log.found && deps.now() - p.startedAt < GIVE_UP_MS) { left.push(p); continue }
          queue.push({
            id: p.id, kind: 'call_out', contactId: p.contactId,
            startedAt: new Date(log.found && log.startedAt ? log.startedAt : p.startedAt).toISOString(),
            durationS: log.found && typeof log.durationS === 'number' ? log.durationS : null
          })
        }
        await save(QUEUE_KEY, queue.slice(-MAX_QUEUE))
        await save(PENDING_KEY, left)
      })
    },

    // Envoi par lots. Accepté ou refusé définitivement : retiré de la file. Réseau ou
    // serveur indisponible : la file reste. Session perdue (401) : file vidée.
    flush(): Promise<void> {
      return serial(async () => {
        let queue = await readList(deps.store, QUEUE_KEY, isEvent)
        while (queue.length) {
          const batch = queue.slice(0, BATCH)
          let done: Set<string>
          try {
            const r = await deps.post(batch)
            done = new Set([...r.accepted, ...r.rejected])
          } catch (e) {
            if (e instanceof DeviceError && e.status === 401) { await save(QUEUE_KEY, []); return }
            // 4xx du lot entier (format refusé) : abandonné, sinon il bloquerait la file à jamais.
            if (e instanceof DeviceError && e.status >= 400 && e.status < 500 && e.status !== 429) done = new Set(batch.map((b) => b.id))
            else return
          }
          queue = queue.filter((q) => !done.has(q.id))
          await save(QUEUE_KEY, queue)
          if (batch.every((b) => !done.has(b.id))) return
        }
      })
    },

    // Session perdue ou remplacée : rien de gardé.
    clear(): Promise<void> {
      return serial(async () => {
        await deps.store.remove(PENDING_KEY).catch(() => {})
        await deps.store.remove(QUEUE_KEY).catch(() => {})
      })
    }
  }
}
