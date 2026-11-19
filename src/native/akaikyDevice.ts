import { registerPlugin } from '@capacitor/core'

// Greffon local de l'app enfant (android/app/src/main/java/.../AkaikyDevicePlugin.kt).
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

// simState : TelephonyManager.getSimState (NAR-180) ; absent (coque plus ancienne), le signal envoie 'unknown'.
export interface DeviceStatus { battery?: number, charging?: boolean, network: 'wifi' | 'cellular' | 'other' | 'none', simState?: 'ready' | 'absent' | 'locked' | 'unknown' }

export interface AkaikyDevicePlugin {
  getStatus(): Promise<DeviceStatus>
  getProvisioning(): Promise<{ pairingToken?: string }>
  clearProvisioning(): Promise<void>
  getInfo(): Promise<DeviceInfo>
}

export const AkaikyDevice = registerPlugin<AkaikyDevicePlugin>('AkaikyDevice')
