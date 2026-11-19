import { registerPlugin } from '@capacitor/core'
import type { ScreenedCall } from '../lib/callJournal'

// Greffon d'appel de l'app enfant (android/app/src/main/java/.../CallPlugin.kt).
// Le natif refuse tout numéro absent de la liste transmise par setAllowed.
export interface ScreeningState {
  available: boolean
  held: boolean
  redirectionAvailable?: boolean
  redirectionHeld?: boolean
  outgoingActive?: boolean
}

export interface AkaikyCallPlugin {
  // Liste des contacts autorisés ; active aussi le filtre des appels entrants (NAR-145).
  // parents, schedules, timezone (NAR-176) : pendant une plage « école », le natif ne laisse
  // sonner et n'appelle que les parents, même écran éteint. Ignorés par une coque plus ancienne.
  setAllowed(options: { numbers: string[], country?: string, parents?: string[], schedules?: { days: number, startMin: number, endMin: number }[], timezone?: string }): Promise<void>
  stopFiltering(): Promise<void>
  peekIncoming(): Promise<{ events: ScreenedCall[] }>
  ackIncoming(options: { ids: string[] }): Promise<void>
  // Rôle de filtrage d'Android 10+ : une confirmation système, une fois.
  // redirection* (NAR-169) : rôle de redirection des appels, filtre des appels sortants ;
  // outgoingActive : état réel de ce filtre (rôle sur Android 10+, récepteur et permission sur
  // Android 8–9). Absents d'une coque plus ancienne.
  screeningRole(): Promise<ScreeningState>
  requestScreeningRole(): Promise<{ held: boolean }>
  requestRedirectionRole(): Promise<{ held: boolean }>
  call(options: { number: string }): Promise<void>
  emergency(options: { number: string }): Promise<void>
  // Dernier appel sortant vers `number` depuis `since` (ms), lu dans le journal d'Android (NAR-166).
  lastOutgoing(options: { number: string, since: number, until?: number, incoming?: boolean }): Promise<{ found: boolean, permission?: boolean, startedAt?: number, durationS?: number }>
}

export const AkaikyCall = registerPlugin<AkaikyCallPlugin>('AkaikyCall')
