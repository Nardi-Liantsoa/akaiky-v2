import { api } from './http'
import type { QuickSlot } from '../lib/quickMessages'

// Journal de l'enfant (NAR-152).
export type JournalFilter = 'all' | 'calls' | 'blocked' | 'messages' | 'unlocks'
export type JournalItem =
  | { id: string, kind: 'call_out' | 'call_in' | 'call_blocked', at: string, contactId: string | null, name: string | null, phone: string | null, durationS: number | null }
  | { id: string, kind: 'unlock', at: string, source: 'code' | 'remote', durationS: number | null }
  | { id: string, kind: 'message', at: string, slot: QuickSlot, readBy: { name: string, readAt: string }[], readByMe: boolean }

// today : nombres du jour (heure de Madagascar) pour les tuiles de synthèse (NAR-175).
export interface JournalToday { calls: number, blocked: number, messages: number, unlocks: number }
export interface JournalPage { items: JournalItem[], next: string | null, today?: JournalToday }

// counts : nombres du jour demandés (écran Journal, au premier chargement d'un enfant).
export const getJournal = (childId: string, { kind = 'all', before, limit = 30, counts = false }: { kind?: JournalFilter, before?: string | null, limit?: number, counts?: boolean } = {}) =>
  api.get<JournalPage>(`/children/${encodeURIComponent(childId)}/journal?kind=${kind}&limit=${limit}${counts ? '&counts=1' : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
