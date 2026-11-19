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
// Owner seul, mot de passe redemandé ; tout ce qui dépend de la famille est effacé.
export const deleteFamily = (password: string) => api.del<{ ok: true }>('/families/me', { password })
export const renameFamily = (name: string) => api.patch<Pick<Family, 'id' | 'name' | 'role'>>('/families/me', { name })

export type InviteRole = Exclude<FamilyRole, 'owner'>

export interface Invitation {
  id: string
  email: string
  role: InviteRole
  createdAt: string
  expiresAt: string
}

export type InvitationPreview = { forThisAccount: false } | { forThisAccount: true, familyName: string, role: InviteRole }

export const listInvitations = () => api.get<Invitation[]>('/families/me/invitations')
export const inviteMember = (email: string, role: InviteRole) => api.post<Invitation>('/families/me/invitations', { email, role })
export const cancelInvitation = (id: string) => api.del<{ ok: true }>(`/families/me/invitations/${encodeURIComponent(id)}`)
export const setMemberRole = (userId: string, role: FamilyRole) =>
  api.patch<{ userId: string, role: FamilyRole }>(`/families/me/members/${encodeURIComponent(userId)}`, { role })
export const removeMember = (userId: string) => api.del<{ ok: true }>(`/families/me/members/${encodeURIComponent(userId)}`)
export const previewInvitation = (token: string) => api.post<InvitationPreview>('/invitations/preview', { token })
export const acceptInvitation = (token: string) => api.post<{ familyId: string, role: InviteRole }>('/invitations/accept', { token })
