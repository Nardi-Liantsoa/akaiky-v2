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
export interface CallLogEntry { found: boolean, startedAt?: number, durationS?: number }

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
    // Appel sur le point de partir : noté AVANT de céder la main au composeur (l'app peut
    // être suspendue pendant l'appel). Renvoie son identifiant, pour l'annuler s'il échoue.
    started(contact: { id: string, name: string }, number: string): Promise<string> {
      return serial(async () => {
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        const id = deps.uuid()
        pending.push({ id, contactId: contact.id, name: contact.name, number, startedAt: deps.now() })
        await save(PENDING_KEY, pending.slice(-MAX_QUEUE))
        return id
      })
    },

    // Appel qui n'est pas parti (refus natif, composeur absent) : rien à journaliser.
    cancel(id: string): Promise<void> {
      return serial(async () => {
        await save(PENDING_KEY, (await readList(deps.store, PENDING_KEY, isPending)).filter((p) => p.id !== id))
      })
    },

    // Durée cherchée dans le journal d'Android pour chaque appel en cours ; renvoie le
    // nombre d'appels encore en attente (Android écrit son journal après la fin de l'appel :
    // l'appelant réessaie un peu plus tard). Fenêtre de chaque appel : de son début (moins
    // 10 s d'écart) au début de l'appel suivant au même numéro.
    complete(): Promise<number> {
      return serial(async () => {
        const pending = await readList(deps.store, PENDING_KEY, isPending)
        if (!pending.length) return 0
        const queue = await readList(deps.store, QUEUE_KEY, isEvent)
        const left: PendingCall[] = []
        const ordered = [...pending].sort((a, b) => a.startedAt - b.startedAt)
        for (const [i, p] of ordered.entries()) {
          const next = ordered.slice(i + 1).find((q) => q.number === p.number)
          const log = await deps.lastOutgoing(p.number, p.startedAt - 10_000, next ? next.startedAt - 10_000 : undefined).catch(() => ({ found: false }) as CallLogEntry)
          if (!log.found && deps.now() - p.startedAt < GIVE_UP_MS) { left.push(p); continue }
          queue.push({
            id: p.id, kind: 'call_out', contactId: p.contactId, name: p.name, phone: p.number,
            startedAt: new Date(log.found && log.startedAt ? log.startedAt : p.startedAt).toISOString(),
            durationS: log.found && typeof log.durationS === 'number' ? log.durationS : null
          })
        }
        await save(QUEUE_KEY, queue.slice(-MAX_QUEUE))
        await save(PENDING_KEY, left)
        return left.length
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
