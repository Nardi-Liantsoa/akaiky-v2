import { api } from './http'
import type { AvatarColor } from '../lib/avatar'

export interface Child {
  id: string
  firstName: string
  avatarColor: AvatarColor
  createdAt: string
}

export const listChildren = () => api.get<Child[]>('/children')
// Sans couleur choisie, le serveur applique sa rotation (calculée sous verrou).
export const addChild = (firstName: string, avatarColor?: AvatarColor) =>
  api.post<Child>('/children', avatarColor ? { firstName, avatarColor } : { firstName })
export const updateChild = (id: string, changes: Partial<Pick<Child, 'firstName' | 'avatarColor'>>) =>
  api.patch<Child>(`/children/${encodeURIComponent(id)}`, changes)
export const removeChild = (id: string) => api.del<{ ok: true }>(`/children/${encodeURIComponent(id)}`)
