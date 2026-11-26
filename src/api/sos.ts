import { api } from './http'

// SOS en ligne (NAR-248, NAR-249). La position n'est jamais dans une URL ni un journal.
export type SosStatus = 'active' | 'cancelled' | 'handled' | 'ended'
export interface SosSummary {
  id: string
  childId: string
  startedAt: string
  endsAt: string
  cancelledAt: string | null
  handledAt: string | null
  status: SosStatus
}
export interface SosEvent { kind: 'seen' | 'coming' | 'handled', at: string, name: string, isMe: boolean }
export interface SosDetails extends SosSummary {
  handledBy: { name: string | null, isMe: boolean } | null
  position: { lat: number, lng: number, accuracyM: number, recordedAt: string } | null
  events: SosEvent[]
}

const one = (id: string) => `/sos/${encodeURIComponent(id)}`
export const activeSos = () => api.get<{ alerts: SosSummary[] }>('/families/me/sos')
export const getSos = (id: string) => api.get<SosDetails>(one(id))
export const markSos = (id: string, kind: 'seen' | 'coming' | 'handle') => api.post<SosDetails>(`${one(id)}/${kind}`, {})
