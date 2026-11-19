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

// Application lançable du téléphone (NAR-143) : icône PNG 48 px en base64, absente si trop lourde.
// Ni l'app elle-même ni une application jamais cachée (appels, SMS, système…). Navigateur
// (vu un jour ici, ou de la liste fixe) : envoyé marqué `browser`, jamais autorisable.
export interface LaunchableApp { package: string, label: string, icon: string | null, browser?: boolean }
export interface AppliedApps { deviceOwner: boolean, armed: boolean, allowed: string[], hidden: number }

export interface AkaikyKioskPlugin {
  status(): Promise<KioskStatus>
  arm(): Promise<KioskStatus>
  disarm(): Promise<KioskStatus>
  // Code parent déjà vérifié par l'écran ; 15 minutes au plus (borné par le natif).
  unlockFor(options: { minutes: number }): Promise<KioskStatus>
  lockNow(): Promise<KioskStatus>
  openSettings(): Promise<void>
  // Applications autorisées (NAR-143) : liste pour le parent, application de la liste reçue
  // (les autres sont cachées si le téléphone est armé), ouverture d'une application autorisée.
  listLaunchableApps(): Promise<{ apps: LaunchableApp[] }>
  applyAllowedApps(options: { packages: string[] }): Promise<AppliedApps>
  launchApp(options: { package: string }): Promise<void>
  // Plage « école » active, app derrière : liste du lock task relue (applications autorisées
  // retirées), puis l'app revient devant (le natif vérifie armé, verrouillé, plage active, pas
  // d'appel en cours) ; `brought` faux si elle n'a pas été ramenée.
  bringToFront(): Promise<{ brought: boolean }>
  // Début ou fin de plage : état du verrou réappliqué (liste du lock task), sortie intacte.
  refresh(): Promise<KioskStatus>
}

export const AkaikyKiosk = registerPlugin<AkaikyKioskPlugin>('AkaikyKiosk')
