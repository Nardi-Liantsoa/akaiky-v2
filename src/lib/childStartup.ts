import { DeviceError, type DeviceInfoBody, type DeviceMe, type DeviceSession } from './deviceSession'

// Démarrage de l'app enfant (NAR-164) : session existante, sinon jeton reçu au
// provisionnement (QR), sinon attente. Dépendances injectées : testable sans natif.
// Le jeton n'est effacé que lorsque le serveur l'a définitivement refusé (401) ou
// accepté : tout autre échec le garde, pour un nouvel essai sans réinitialiser.
export type ChildState =
  | { kind: 'paired', firstName: string, childId: string }
  | { kind: 'waiting' }
  | { kind: 'expired' }      // jeton expiré ou déjà utilisé : nouveau QR, donc réinitialisation
  | { kind: 'tooMany' }      // plafond atteint : un parent retire un téléphone, puis on réessaie
  | { kind: 'revoked' }      // session refusée (401) : téléphone retiré par un parent
  | { kind: 'offline' }      // réseau ou serveur indisponible (5xx, 429) : réessayer
  | { kind: 'failed' }       // autre refus (4xx) : réessayer, puis assistance

export interface ChildDeps {
  session: DeviceSession
  provisioning: { token(): Promise<string | null>, clear(): Promise<void> }
  info(): Promise<DeviceInfoBody>
}

const refused = (e: unknown) => e instanceof DeviceError && e.status === 401
// Réseau coupé (pas de DeviceError) ou serveur momentanément indisponible.
const transient = (e: unknown) => !(e instanceof DeviceError) || e.status >= 500 || e.status === 429

async function me(session: DeviceSession): Promise<ChildState> {
  const r = await session.get<DeviceMe>('/device/me')
  return { kind: 'paired', firstName: r.child.firstName, childId: r.child.id }
}

export async function startChild(deps: ChildDeps): Promise<ChildState> {
  try {
    const hadSession = await deps.session.hasSession()
    if (hadSession) {
      try {
        return await me(deps.session)
      } catch (e) {
        // Seul un 401 dit que le téléphone a été retiré ; un jeton récent peut encore servir.
        if (!refused(e)) return transient(e) ? { kind: 'offline' } : { kind: 'failed' }
      }
    }
    // Jeton lu seulement sans session valable : une session saine ne dépend pas du greffon.
    const token = await deps.provisioning.token()
    // Session refusée et aucun jeton : le téléphone a été retiré par un parent.
    if (!token) return hadSession ? { kind: 'revoked' } : { kind: 'waiting' }
    try {
      await deps.session.pair(token, await deps.info())
    } catch (e) {
      if (refused(e)) { await deps.provisioning.clear().catch(() => {}); return { kind: 'expired' } }
      // Refus de place : la transaction serveur est annulée, le jeton reste valable.
      if (e instanceof DeviceError && e.code === 'too_many_devices') return { kind: 'tooMany' }
      return transient(e) ? { kind: 'offline' } : { kind: 'failed' }
    }
    // Jeton consommé : l'effacer ne doit pas masquer un appairage réussi.
    await deps.provisioning.clear().catch(() => {})
    return await me(deps.session)
  } catch (e) {
    if (refused(e)) return { kind: 'revoked' }
    return transient(e) ? { kind: 'offline' } : { kind: 'failed' }
  }
}
