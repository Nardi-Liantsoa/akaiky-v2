import { api } from './http'

// Position à la demande (NAR-203, NAR-205). Jamais de position dans une URL.
export interface ChildPosition { lat: number, lng: number, accuracyM: number, recordedAt: string }
export interface PositionState { position: ChildPosition | null, requestedAt: string | null, watchingUntil: string | null }

const child = (id: string) => `/children/${encodeURIComponent(id)}`
export const requestLocate = (childId: string) => api.post<{ requestedAt: string, watchingUntil: string }>(`${child(childId)}/locate`, {})
export const getPosition = (childId: string) => api.get<PositionState>(`${child(childId)}/position`)
