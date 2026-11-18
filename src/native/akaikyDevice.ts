import { registerPlugin } from '@capacitor/core'

// Greffon local de l'app enfant (android/app/src/main/java/.../AkaikyDevicePlugin.java).
// Android seulement ; appelé uniquement quand appKind() vaut « enfant ».
export interface DeviceInfo {
  model?: string
  osVersion?: string
  appVersion?: string
  webViewPackage?: string
  webViewVersion?: string
  webViewMajor?: number
  deviceOwner: boolean
}

export interface AkaikyDevicePlugin {
  getProvisioning(): Promise<{ pairingToken?: string }>
  clearProvisioning(): Promise<void>
  getInfo(): Promise<DeviceInfo>
}

export const AkaikyDevice = registerPlugin<AkaikyDevicePlugin>('AkaikyDevice')
