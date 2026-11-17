import { api } from './http'
import type { AvatarColor } from '../lib/avatar'
import type { FamilyRole } from './families'

export interface Contact {
  id: string
  childId: string
  name: string
  phone: string
  position: number
  avatarColor: AvatarColor
  memberUserId: string | null
  memberRole: FamilyRole | null
}

export interface ContactList {
  version: number
  max: number
  contacts: Contact[]
}

export interface ContactInput {
  name: string
  phone: string
  avatarColor?: AvatarColor
  memberUserId?: string | null
}

const child = (id: string) => `/children/${encodeURIComponent(id)}/contacts`
export const listContacts = (childId: string) => api.get<ContactList>(child(childId))
export const addContact = (childId: string, input: ContactInput) => api.post<Contact>(child(childId), input)
export const updateContact = (id: string, changes: Partial<ContactInput>) => api.patch<Contact>(`/contacts/${encodeURIComponent(id)}`, changes)
export const removeContact = (id: string) => api.del<{ ok: true }>(`/contacts/${encodeURIComponent(id)}`)
export const reorderContacts = (childId: string, ids: string[]) => api.put<{ ok: true }>(`${child(childId)}/order`, { ids })
