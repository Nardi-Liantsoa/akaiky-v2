import { registerPlugin } from '@capacitor/core'

// Mode appareil dédié de l'app enfant (NAR-167), android/app/src/enfant/.../KioskPlugin.kt.
// Appelé uniquement sur le téléphone de l'enfant (appKind « enfant ») ; ailleurs, le
// composable useKiosk ne l'appelle pas.
// Sortie du verrou : 15 minutes au plus (CdC §5.3), comme le natif et le serveur.
export const UNLOCK_MINUTES = 15

export interface KioskStatus {
  deviceOwner: boolean
  // Armé : téléphone appairé, verrou voulu (restrictions et lanceur posés).
  armed: boolean
  // Écran fixé (lock task) en ce moment.
  locked: boolean
  // Fin de la sortie temporaire en cours (ms), absente si verrouillé.
  unlockedUntil?: number
}

export interface AkaikyKioskPlugin {
  status(): Promise<KioskStatus>
  arm(): Promise<KioskStatus>
  disarm(): Promise<KioskStatus>
  // Code parent déjà vérifié par l'écran ; 15 minutes au plus (borné par le natif).
  unlockFor(options: { minutes: number }): Promise<KioskStatus>
  lockNow(): Promise<KioskStatus>
  openSettings(): Promise<void>
}

export const AkaikyKiosk = registerPlugin<AkaikyKioskPlugin>('AkaikyKiosk')
