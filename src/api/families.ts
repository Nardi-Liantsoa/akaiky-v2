import { api } from './http'

export type FamilyRole = 'owner' | 'manager' | 'member'

export interface FamilyMember {
  userId: string
  name: string
  role: FamilyRole
  isMe: boolean
}

export interface Family {
  id: string
  name: string
  role: FamilyRole
  members: FamilyMember[]
}

export const getMyFamily = () => api.get<Family>('/families/me')
export const createFamily = (name: string) => api.post<Pick<Family, 'id' | 'name' | 'role'>>('/families', { name })
export const renameFamily = (name: string) => api.patch<Pick<Family, 'id' | 'name' | 'role'>>('/families/me', { name })
