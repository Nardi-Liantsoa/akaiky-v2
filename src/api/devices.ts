import { api } from './http'

// Charge utile du QR de provisionnement Android (Device Owner), construite par le
// serveur : le seul secret est le jeton d'appairage, 15 minutes et usage unique.
export interface Pairing {
  expiresAt: string
  provisioning: Record<string, unknown>
}

export interface ChildDevice {
  id: string
  model: string | null
  osVersion: string | null
  appVersion: string | null
  createdAt: string
  lastSeenAt: string
}

const child = (id: string) => `/children/${encodeURIComponent(id)}`
export const createPairing = (childId: string) => api.post<Pairing>(`${child(childId)}/pairing`, {})
export const listDevices = (childId: string) => api.get<ChildDevice[]>(`${child(childId)}/devices`)
export const revokeDevice = (id: string) => api.post<{ ok: true }>(`/devices/${encodeURIComponent(id)}/revoke`, {})
