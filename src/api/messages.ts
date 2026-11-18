import { api } from './http'
import type { QuickSlot } from '../lib/quickMessages'

// Messages rapides de l'enfant (NAR-150), lus par les membres de la famille.
export interface QuickMessage {
  id: string
  slot: QuickSlot
  sentAt: string
  readBy: { name: string, readAt: string }[]
  readByMe: boolean
}

export const listMessages = (childId: string, limit = 50) => api.get<QuickMessage[]>(`/children/${encodeURIComponent(childId)}/messages?limit=${limit}`)
export const markRead = (id: string) => api.post<{ ok: true }>(`/messages/${encodeURIComponent(id)}/read`)
