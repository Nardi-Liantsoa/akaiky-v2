import { registerPlugin } from '@capacitor/core'

// Signal de vie en arrière-plan de l'app enfant (NAR-180),
// android/app/src/enfant/.../BackgroundStatusPlugin.kt. Android, variante enfant seulement.
export interface AkaikyBackgroundPlugin {
  // Téléphone appairé : POST /api/device/heartbeat toutes les 15 minutes (et à chaque
  // événement batterie ou carte SIM), écran éteint compris, avec le jeton « signal de vie »
  // `token` (POST /api/device/heartbeat-token), gardé chiffré par le natif. Idempotent.
  startBackgroundStatus(options: { apiBase: string, token: string }): Promise<void>
  // Rendu une fois l'arrêt fait : plus aucun signal ne part.
  stopBackgroundStatus(): Promise<void>
  // `needsToken` : jeton refusé (401, surveillance arrêtée) ou illisible : en émettre un autre.
  status(): Promise<{ enabled: boolean, needsToken: boolean }>
}

export const AkaikyBackground = registerPlugin<AkaikyBackgroundPlugin>('AkaikyBackground')
