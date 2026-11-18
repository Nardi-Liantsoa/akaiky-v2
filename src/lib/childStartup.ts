import { DeviceError, type DeviceInfoBody, type DeviceMe, type DeviceSession } from './deviceSession'

// Démarrage de l'app enfant (NAR-164) : session existante, sinon jeton reçu au
// provisionnement (QR), sinon attente. Dépendances injectées : testable sans natif.
// Le jeton n'est effacé que lorsque le serveur l'a définitivement refusé (401) ou
// accepté : tout autre échec le garde, pour un nouvel essai sans réinitialiser.
export type ChildState =
  | { kind: 'paired', firstName: string }
  | { kind: 'waiting' }
  | { kind: 'expired' }      // jeton expiré ou déjà utilisé : nouveau QR, donc réinitialisation
  | { kind: 'tooMany' }      // plafond atteint : un parent retire un téléphone, puis on réessaie
  | { kind: 'revoked' }      // session refusée (401) : téléphone retiré par un parent
  | { kind: 'offline' }      // réseau, serveur ou réponse inattendue : réessayer, rien n'est perdu

export interface ChildDeps {
  session: DeviceSession
  provisioning: { token(): Promise<string | null>, clear(): Promise<void> }
  info(): Promise<DeviceInfoBody>
}

const refused = (e: unknown) => e instanceof DeviceError && e.status === 401

async function me(session: DeviceSession): Promise<ChildState> {
  const r = await session.get<DeviceMe>('/device/me')
  return { kind: 'paired', firstName: r.child.firstName }
}

export async function startChild(deps: ChildDeps): Promise<ChildState> {
  try {
    const token = await deps.provisioning.token()
    if (await deps.session.hasSession()) {
      try {
        return await me(deps.session)
      } catch (e) {
        // Seul un 401 dit que le téléphone a été retiré ; un jeton récent peut encore servir.
        if (!refused(e)) return { kind: 'offline' }
        if (!token) return { kind: 'revoked' }
      }
    }
    if (!token) return { kind: 'waiting' }
    try {
      await deps.session.pair(token, await deps.info())
    } catch (e) {
      if (refused(e)) { await deps.provisioning.clear(); return { kind: 'expired' } }
      // Refus de place : la transaction serveur est annulée, le jeton reste valable.
      if (e instanceof DeviceError && e.code === 'too_many_devices') return { kind: 'tooMany' }
      return { kind: 'offline' }
    }
    await deps.provisioning.clear()
    return await me(deps.session)
  } catch (e) {
    return refused(e) ? { kind: 'revoked' } : { kind: 'offline' }
  }
}
