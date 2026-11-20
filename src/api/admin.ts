import { api } from './http'

// Back-office de l'équipe (NAR-144) : réservé aux administrateurs (MFA), lecture seule.
// Ni prénom, ni numéro, ni nom de famille, ni position, ni journal d'appels : la famille
// est désignée par son identifiant.
export interface AdminFamily { id: string, members: number, children: number, devices: number, createdAt: string }
export type AdminDeviceState = 'active' | 'silent' | 'revoked'
export interface AdminDevice {
  id: string
  familyId: string
  model: string | null
  osVersion: string | null
  appVersion: string | null
  createdAt: string
  lastSeenAt: string
  // Dernier signal de vie ; null tant que le téléphone n'en a envoyé aucun.
  statusAt: string | null
  revokedAt: string | null
  state: AdminDeviceState
}
export interface AdminStats {
  families: number
  children: number
  devices: number
  activeDevices: number
  silentDevices: number
  devicesSignal24h: number
  sosThisMonth: number
  // Faux tant que le serveur ne reçoit pas le journal des SOS (NAR-181) : sosThisMonth vaut 0.
  sosTracked: boolean
}
export interface AdminPage<T> { items: T[], next: string | null }

export const ADMIN_PAGE_SIZE = 50
const paged = (path: string, before: string | null) =>
  `${path}?limit=${ADMIN_PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`

export const listAdminFamilies = (before: string | null = null) => api.get<AdminPage<AdminFamily>>(paged('/admin/families', before))
export const listAdminDevices = (before: string | null = null) => api.get<AdminPage<AdminDevice>>(paged('/admin/devices', before))
export const getAdminStats = () => api.get<AdminStats>('/admin/stats')
// Référence courte d'une famille ou d'un téléphone pour l'affichage (8 premiers caractères de l'id).
export const shortId = (id: string) => id.slice(0, 8)
