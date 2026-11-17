import { api } from './http'
import type { AvatarColor } from '../lib/avatar'

export interface Child {
  id: string
  firstName: string
  avatarColor: AvatarColor
  createdAt: string
}

export const listChildren = () => api.get<Child[]>('/children')
export const addChild = (firstName: string, avatarColor: AvatarColor) => api.post<Child>('/children', { firstName, avatarColor })
export const updateChild = (id: string, changes: Partial<Pick<Child, 'firstName' | 'avatarColor'>>) =>
  api.patch<Child>(`/children/${encodeURIComponent(id)}`, changes)
export const removeChild = (id: string) => api.del<{ ok: true }>(`/children/${encodeURIComponent(id)}`)
