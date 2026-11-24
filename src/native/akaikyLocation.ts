import { registerPlugin } from '@capacitor/core'

// Position à la demande de l'app enfant (NAR-204), android/app/src/enfant/.../LocationPlugin.kt.
// Android, variante enfant seulement. Un relevé unique (20 s au plus), pris après l'appel :
// jamais de suivi ni de « dernière position connue ». `ageS` : âge du relevé (horloge monotone).
// Refus : `busy`, `denied`, `unavailable`, `timeout`.
export interface Fix { lat: number, lng: number, accuracyM: number, ageS: number }

export interface AkaikyLocationPlugin {
  currentPosition(options?: { timeoutMs?: number }): Promise<Fix>
}

export const AkaikyLocation = registerPlugin<AkaikyLocationPlugin>('AkaikyLocation')
