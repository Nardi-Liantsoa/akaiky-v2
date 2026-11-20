import type { ScreeningState } from '../native/akaikyCall'

// État des filtres d'appel lu sur le téléphone (NAR-145, NAR-169), pour le bandeau de l'écran
// enfant. Coque plus ancienne sans `outgoingActive` : l'état du rôle de redirection fait foi.

/**
 * Filtre des appels entrants réellement inactif (NAR-172 : `incomingActive`, rôle sur 10+,
 * récepteur et permissions sur 8–9). Coque plus ancienne : rôle demandable et absent.
 */
export function incomingFilterOff(s: ScreeningState | null): boolean {
  if (!s) return false
  if (s.incomingActive !== undefined) return !s.incomingActive
  return !!s.available && !s.held
}

/** Rôle de filtrage demandable par une confirmation système (Android 10+). */
export function canRequestScreening(s: ScreeningState | null): boolean {
  return !!s?.available && !s.held
}

/** Filtre des appels sortants réellement inactif (rôle absent sur 10+, récepteur ou permission sur 8–9). */
export function outgoingFilterOff(s: ScreeningState | null): boolean {
  if (!s) return false
  if (s.outgoingActive !== undefined) return !s.outgoingActive
  return !!s.redirectionAvailable && !s.redirectionHeld
}

/** Rôle de redirection demandable par une confirmation système (Android 10+). */
export function canRequestRedirection(s: ScreeningState | null): boolean {
  return !!s?.redirectionAvailable && !s.redirectionHeld
}
