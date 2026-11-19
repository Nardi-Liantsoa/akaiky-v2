import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { SosContact } from '../lib/sosCascade'

// SOS hors ligne de l'app enfant (NAR-151), android/app/src/enfant/.../SosPlugin.kt :
// service au premier plan (SMS avec position, cascade d'appels, sirène), qui continue
// écran éteint. Absent d'une coque plus ancienne (« not implemented ») : l'écran garde
// alors l'ancien SOS (premier contact, puis secours).
export type SosSmsStatus = 'pending' | 'sent' | 'failed'
export interface SosState {
  active: boolean
  // starting : position et SMS ; calling : appel `index` de `calls` ; emergency : secours
  // (liste épuisée si index = calls.length, sinon choisis par l'enfant).
  // failed : service impossible (SMS sans position tentés), l'écran passe à l'appel direct.
  // interrupted : SOS arrêté avant sa fin (Android, redémarrage, jamais repris) : rien ne tourne.
  status?: 'starting' | 'calling' | 'answered' | 'cancelled' | 'emergency' | 'failed' | 'interrupted'
  // pending : état provisoire posé par le plugin au lancement, avant celui du service.
  pending?: boolean
  // resumed : SOS repris après l'arrêt de l'app ; interrupted : arrêté par Android avant la fin.
  resumed?: boolean
  interrupted?: boolean
  runId?: string
  startedAt?: number
  index?: number
  redial?: boolean
  inCall?: boolean
  calls?: string[]
  sms?: { id: string, name: string, status: SosSmsStatus }[]
  positionKnown?: boolean
  siren?: boolean
  emergency?: string
  // Prénom du contact qui a répondu, ou « incoming » : un parent a appelé le téléphone.
  answeredBy?: string
}

export interface AkaikySosPlugin {
  // smsWith : modèle traduit, prénom posé ; {lat}, {lon}, {acc}, {time} remplis par le natif.
  // `parent` des contacts relu par le natif (liste reçue par setAllowed), jamais celui-ci.
  start(options: {
    contacts: SosContact[], emergency: string, siren: boolean, smsWith: string, smsWithout: string,
    notifyTitle: string, notifyText: string, timezone: string
  }): Promise<{ started: boolean, already?: boolean, failed?: boolean, runId?: string, state?: SosState }>
  // {} : « Annuler » de l'enfant. { runId, fallback: true } : l'écran passe à l'appel direct ;
  // ce SOS est annulé s'il tourne et ne sera jamais lancé s'il n'a pas encore démarré.
  cancel(options?: { runId?: string, fallback?: boolean }): Promise<void>
  // « Appeler les secours » pendant le SOS : cascade arrêtée, composeur ouvert par le service.
  // handled faux : aucun SOS en cours, l'écran ouvre le composeur lui-même.
  emergency(): Promise<{ handled: boolean }>
  state(): Promise<SosState>
  addListener(event: 'sosUpdate', listener: (state: SosState) => void): Promise<PluginListenerHandle>
}

export const AkaikySos = registerPlugin<AkaikySosPlugin>('AkaikySos')
