import { api } from './http'
import type { AvatarColor } from '../lib/avatar'

export interface Child {
  id: string
  firstName: string
  avatarColor: AvatarColor
  createdAt: string
  // Date du dernier code parent défini (NAR-139) ; le code et son hachage ne sont jamais envoyés.
  parentCodeSetAt: string | null
  // Fin d'un déverrouillage demandé à distance (NAR-168), absente une fois passée.
  remoteUnlockUntil: string | null
  // Dernier passage du téléphone de l'enfant (NAR-174) ; null sans téléphone relié.
  phoneLastSeenAt: string | null
  // Sirène pendant un SOS (NAR-151), appliquée hors ligne par le téléphone de l'enfant.
  sosSiren: boolean
}

export const listChildren = () => api.get<Child[]>('/children')
// Sans couleur choisie, le serveur applique sa rotation (calculée sous verrou).
// parentalConsent : autorité parentale et journalisation acceptées (NAR-178), exigé par le serveur.
export const addChild = (firstName: string, avatarColor?: AvatarColor) =>
  api.post<Child>('/children', avatarColor ? { firstName, avatarColor, parentalConsent: true } : { firstName, parentalConsent: true })
export const updateChild = (id: string, changes: Partial<Pick<Child, 'firstName' | 'avatarColor'>>) =>
  api.patch<Child>(`/children/${encodeURIComponent(id)}`, changes)
export const removeChild = (id: string) => api.del<{ ok: true }>(`/children/${encodeURIComponent(id)}`)
export const setParentCode = (id: string, code: string) =>
  api.put<{ parentCodeSetAt: string }>(`/children/${encodeURIComponent(id)}/parent-code`, { code })
export const remoteUnlock = (id: string) =>
  api.post<{ remoteUnlockUntil: string }>(`/children/${encodeURIComponent(id)}/unlock`)
export const setSosSiren = (id: string, enabled: boolean) =>
  api.put<{ sosSiren: boolean }>(`/children/${encodeURIComponent(id)}/sos-siren`, { enabled })
