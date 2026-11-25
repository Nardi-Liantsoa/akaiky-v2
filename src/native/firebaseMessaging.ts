import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Notifications push (NAR-179) : greffon natif @capacitor-firebase/messaging, appelé par son
// nom. Son code JavaScript (et le SDK web Firebase qu'il chargerait) n'entre pas dans le
// bundle : seule l'app native reçoit des notifications. Jeton FCM sur Android et iOS.
// Sans google-services.json (Android) ou GoogleService-Info.plist (iOS), les appels sont
// refusés et l'app marche sans notifications (aucun plantage au démarrage).
export type PushPermission = 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
export interface PushNotification {
  title?: string
  body?: string
  // `data` du serveur : { type, id } seulement (server/src/push.js), jamais le contenu.
  data?: unknown
}

export interface FirebaseMessagingPlugin {
  checkPermissions(): Promise<{ receive: PushPermission }>
  requestPermissions(): Promise<{ receive: PushPermission }>
  getToken(): Promise<{ token: string }>
  createChannel(channel: { id: string, name: string, description?: string, importance: 1 | 2 | 3 | 4 | 5, visibility?: -1 | 0 | 1 }): Promise<void>
  addListener(event: 'tokenReceived', cb: (e: { token: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'notificationReceived', cb: (e: { notification: PushNotification }) => void): Promise<PluginListenerHandle>
  addListener(event: 'notificationActionPerformed', cb: (e: { actionId: string, notification: PushNotification }) => void): Promise<PluginListenerHandle>
}

export const FirebaseMessaging = registerPlugin<FirebaseMessagingPlugin>('FirebaseMessaging')
