import { registerPlugin } from '@capacitor/core'

// Position à la demande de l'app enfant (NAR-204), android/app/src/enfant/.../LocationPlugin.kt.
// Android, variante enfant seulement. Un relevé unique (20 s au plus), pris après l'appel :
// jamais de suivi ni de « dernière position connue ». `ageS` : âge du relevé (horloge monotone).
// Refus : `busy`, `denied`, `unavailable`, `timeout` (aucun relevé de précision connue), `cancelled`.
export interface Fix { lat: number, lng: number, accuracyM: number, ageS: number }

export interface AkaikyLocationPlugin {
  currentPosition(options?: { timeoutMs?: number }): Promise<Fix>
  // Relevé en cours abandonné (son appel est refusé, `cancelled`) ; sans effet s'il n'y en a pas.
  cancel(): Promise<void>
}

export const AkaikyLocation = registerPlugin<AkaikyLocationPlugin>('AkaikyLocation')
