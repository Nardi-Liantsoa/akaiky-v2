import { registerPlugin } from '@capacitor/core'

// Mise à jour de l'app enfant par elle-même, téléphone verrouillé (NAR-170),
// android/app/src/enfant/.../ApkUpdatePlugin.kt. Android, variante enfant seulement.
export interface UpdateStatus {
  // versionCode installé ; lastAttemptAt : dernière tentative (ms), gardée par le natif.
  versionCode: number, lastAttemptAt?: number, lastResult?: string, running: boolean
}

export interface AkaikyUpdatePlugin {
  status(): Promise<UpdateStatus>
  // Télécharge, vérifie (SHA-256, paquet, version, certificat) et remet l'installation au
  // système ; rendu une fois la session remise (l'app redémarre ensuite dans sa nouvelle version).
  install(options: { url: string, sha256: string, versionCode: number }): Promise<{ committed: boolean }>
}

export const AkaikyUpdate = registerPlugin<AkaikyUpdatePlugin>('AkaikyUpdate')
