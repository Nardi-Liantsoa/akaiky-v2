import { DeviceError, type SecretStore } from './deviceSession'

// Messages rapides en attente d'envoi (NAR-150). Gardés dans le stockage sécurisé : un
// message touché hors ligne part au retour du réseau, une seule fois (identifiant choisi
// ici, le serveur ignore un rejeu). Envoyés dans l'ordre, un par un.
export const OUTBOX_KEY = 'quick-messages-outbox'
const MAX = 200

export interface OutgoingMessage { id: string, slot: 1 | 2 | 3 | 4, sentAt: string }

const valid = (v: unknown): v is OutgoingMessage => {
  const m = v as OutgoingMessage | null
  return typeof m?.id === 'string' && [1, 2, 3, 4].includes(m.slot) && typeof m.sentAt === 'string'
}

export function createMessageOutbox({ store, post, uuid, now }: {
  store: SecretStore
  post(message: OutgoingMessage): Promise<unknown>
  uuid(): string
  now(): number
}) {
  let chain: Promise<unknown> = Promise.resolve()
  let flushing: Promise<{ sent: string[], refused: string[] }> | null = null
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn)
    chain = next.catch(() => {})
    return next
  }
  async function read(): Promise<OutgoingMessage[]> {
    try {
      const raw = await store.get(OUTBOX_KEY)
      const list = typeof raw === 'string' ? JSON.parse(raw) : []
      return Array.isArray(list) ? list.filter(valid) : []
    } catch {
      return []
    }
  }
  const write = (list: OutgoingMessage[]) => store.set(OUTBOX_KEY, JSON.stringify(list.slice(-MAX)))

  return {
    // Message touché : noté avant tout envoi (l'app peut s'arrêter juste après).
    add(slot: 1 | 2 | 3 | 4): Promise<OutgoingMessage> {
      return locked(async () => {
        const message = { id: uuid(), slot, sentAt: new Date(now()).toISOString() }
        await write([...(await read()), message])
        return message
      })
    },

    // Envoi de la file, dans l'ordre. Aucun verrou tenu pendant la requête réseau (une
    // session perdue efface la file : clear() ne doit jamais attendre un envoi). Un seul
    // envoi à la fois : un appel pendant un envoi reçoit le même résultat.
    // sent : partis ; refused : refusés pour de bon (4xx hors 429), retirés de la file.
    // Réseau ou serveur indisponible : la file reste. Session perdue (401) : file vidée.
    flush(): Promise<{ sent: string[], refused: string[] }> {
      // Envoi en cours : celui-ci part juste après (le message qui vient d'être ajouté
      // n'était pas dans la file lue par l'envoi en cours).
      if (flushing) return flushing.then(() => this.flush(), () => this.flush())
      const run = (async () => {
        const sent: string[] = [], refused: string[] = []
        try {
          for (const m of await locked(read)) {
            try {
              await post(m)
              sent.push(m.id)
            } catch (e) {
              if (e instanceof DeviceError && e.status === 401) {
                // Session perdue : file vidée ; ces messages ne partiront pas.
                const lost = await locked(async () => { const all = await read(); await write([]); return all })
                refused.push(...lost.map((x) => x.id))
                break
              }
              if (!(e instanceof DeviceError && e.status >= 400 && e.status < 500 && e.status !== 429)) break
              refused.push(m.id)
            }
            await locked(async () => write((await read()).filter((q) => q.id !== m.id)))
          }
        } finally {
          flushing = null
        }
        return { sent, refused }
      })()
      flushing = run
      return run
    },

    pending: () => read(),
    clear: () => locked(() => store.remove(OUTBOX_KEY).catch(() => {}))
  }
}
