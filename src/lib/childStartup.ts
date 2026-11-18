import { DeviceError, type DeviceInfoBody, type DeviceMe, type DeviceSession } from './deviceSession'

// Démarrage de l'app enfant (NAR-164) : session existante, sinon jeton reçu au
// provisionnement (QR), sinon attente. Dépendances injectées : testable sans natif.
export type ChildState =
  | { kind: 'paired', firstName: string }
  | { kind: 'waiting' }
  | { kind: 'expired' }      // jeton expiré ou déjà utilisé : nouveau QR, donc réinitialisation
  | { kind: 'tooMany' }      // plafond de téléphones de l'enfant atteint
  | { kind: 'revoked' }      // session refusée : téléphone retiré par un parent
  | { kind: 'offline' }      // réseau ou serveur indisponible : réessayer, rien n'est perdu

export interface ChildDeps {
  session: DeviceSession
  provisioning: { token(): Promise<string | null>, clear(): Promise<void> }
  info(): Promise<DeviceInfoBody>
}

const transient = (e: unknown) => !(e instanceof DeviceError) || e.status >= 500 || e.status === 429

async function me(session: DeviceSession): Promise<ChildState> {
  const r = await session.get<DeviceMe>('/device/me')
  return { kind: 'paired', firstName: r.child.firstName }
}

export async function startChild(deps: ChildDeps): Promise<ChildState> {
  try {
    if (await deps.session.hasSession()) {
      try {
        return await me(deps.session)
      } catch (e) {
        // Session refusée : le téléphone a été retiré. Un jeton récent peut encore servir.
        if (transient(e)) return { kind: 'offline' }
        if (!(await deps.provisioning.token())) return { kind: 'revoked' }
      }
    }
    const token = await deps.provisioning.token()
    if (!token) return { kind: 'waiting' }
    try {
      await deps.session.pair(token, await deps.info())
    } catch (e) {
      if (transient(e)) return { kind: 'offline' }   // jeton gardé : nouvel essai possible
      // Refus définitif : le jeton ne servira plus.
      await deps.provisioning.clear()
      if (e instanceof DeviceError && e.code === 'too_many_devices') return { kind: 'tooMany' }
      return { kind: 'expired' }
    }
    await deps.provisioning.clear()
    return await me(deps.session)
  } catch (e) {
    if (transient(e)) return { kind: 'offline' }
    return { kind: 'revoked' }
  }
}
