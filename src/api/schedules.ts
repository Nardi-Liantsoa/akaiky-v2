import { api } from './http'

// Plages horaires « école » d'un enfant (NAR-148). Heures en minutes depuis minuit, dans
// le fuseau de la famille ; jours : bit 0 = lundi … bit 6 = dimanche.
export interface Schedule { id: string, label: string, days: number, startMin: number, endMin: number, enabled: boolean }
export type ScheduleInput = Omit<Schedule, 'id'>
const base = (childId: string) => `/children/${encodeURIComponent(childId)}/schedules`
export const getSchedules = (childId: string) => api.get<Schedule[]>(base(childId))
export const createSchedule = (childId: string, s: ScheduleInput) => api.post<Schedule>(base(childId), s)
export const updateSchedule = (childId: string, id: string, s: ScheduleInput) => api.put<Schedule>(`${base(childId)}/${encodeURIComponent(id)}`, s)
export const deleteSchedule = (childId: string, id: string) => api.del<{ ok: true }>(`${base(childId)}/${encodeURIComponent(id)}`)
