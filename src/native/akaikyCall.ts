import { registerPlugin } from '@capacitor/core'

// Greffon d'appel de l'app enfant (android/app/src/main/java/.../CallPlugin.kt).
// Le natif refuse tout numéro absent de la liste transmise par setAllowed.
export interface AkaikyCallPlugin {
  setAllowed(options: { numbers: string[] }): Promise<void>
  call(options: { number: string }): Promise<void>
  emergency(options: { number: string }): Promise<void>
}

export const AkaikyCall = registerPlugin<AkaikyCallPlugin>('AkaikyCall')
