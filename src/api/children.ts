import { api } from './http'
import type { AvatarColor } from '../lib/avatar'

export interface Child {
  id: string
  firstName: string
  avatarColor: AvatarColor
  createdAt: string
  // Date du dernier code parent défini (NAR-139) ; le code et son hachage ne sont jamais envoyés.
  parentCodeSetAt: string | null
}

export const listChildren = () => api.get<Child[]>('/children')
// Sans couleur choisie, le serveur applique sa rotation (calculée sous verrou).
export const addChild = (firstName: string, avatarColor?: AvatarColor) =>
  api.post<Child>('/children', avatarColor ? { firstName, avatarColor } : { firstName })
export const updateChild = (id: string, changes: Partial<Pick<Child, 'firstName' | 'avatarColor'>>) =>
  api.patch<Child>(`/children/${encodeURIComponent(id)}`, changes)
export const removeChild = (id: string) => api.del<{ ok: true }>(`/children/${encodeURIComponent(id)}`)
export const setParentCode = (id: string, code: string) =>
  api.put<{ parentCodeSetAt: string }>(`/children/${encodeURIComponent(id)}/parent-code`, { code })
