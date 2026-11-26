import { api } from './http'

// Back-office de l'équipe (NAR-144) : réservé aux administrateurs (MFA). Tranche 2 (NAR-199) :
// désactiver ou réactiver un compte, retirer un téléphone (corps vide, réponse { ok }).
// Ni prénom, ni numéro, ni nom de famille, ni position, ni journal d'appels : la famille
// est désignée par son identifiant.
// Compte vu par l'équipe : jamais le numéro (compte à numéro : email null, sms_account vrai).
export interface AdminAccount {
  id: string
  email: string | null
  name: string
  is_admin: boolean
  created_at: string
  email_verified_at: string | null
  sms_account: boolean
  verified: boolean
  // Désactivé par l'équipe (NAR-199) : date, sinon null.
  disabled_at: string | null
  mfa: boolean
}
export interface AdminAuditEntry { at: string, action: string, target: string | null, actor: string | null }
export interface AdminFamily { id: string, members: number, children: number, devices: number, createdAt: string }
// Enfant d'une famille vu par l'équipe (NAR-200) : identifiant, date, code défini, demande de
// nouveau code en cours. Jamais le prénom, le numéro ni le code.
export interface AdminChild { id: string, createdAt: string, codeSet: boolean, newCodeRequestedAt: string | null }
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
  // Vrai depuis le SOS en ligne (NAR-248) : alertes reçues par le serveur (un SOS resté hors ligne n'est pas compté).
  sosTracked: boolean
}
export interface AdminPage<T> { items: T[], next: string | null }

export const ADMIN_PAGE_SIZE = 50
const paged = (path: string, before: string | null) =>
  `${path}?limit=${ADMIN_PAGE_SIZE}${before ? `&before=${encodeURIComponent(before)}` : ''}`

export const listAdminFamilies = (before: string | null = null) => api.get<AdminPage<AdminFamily>>(paged('/admin/families', before))
export const listAdminDevices = (before: string | null = null) => api.get<AdminPage<AdminDevice>>(paged('/admin/devices', before))
export const getAdminStats = () => api.get<AdminStats>('/admin/stats')
export const listAdminUsers = () => api.get<AdminAccount[]>('/admin/users')
export const listAdminAudit = () => api.get<AdminAuditEntry[]>('/admin/audit')
const enc = encodeURIComponent
export const disableAdminUser = (id: string) => api.post<{ ok: true }>(`/admin/users/${enc(id)}/disable`)
export const enableAdminUser = (id: string) => api.post<{ ok: true }>(`/admin/users/${enc(id)}/enable`)
export const listAdminFamilyChildren = (familyId: string) => api.get<AdminChild[]>(`/admin/families/${enc(familyId)}/children`)
// Demande d'un nouveau code parent (NAR-200) : l'ancien reste valable, rien n'est déverrouillé.
export const requestNewParentCode = (childId: string) => api.post<{ ok: true }>(`/admin/children/${enc(childId)}/parent-code/reset`)
export const revokeAdminDevice = (id: string) => api.post<{ ok: true }>(`/admin/devices/${enc(id)}/revoke`)
// Référence courte d'une famille ou d'un téléphone pour l'affichage (8 premiers caractères de l'id).
export const shortId = (id: string) => id.slice(0, 8)
