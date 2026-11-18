import { api } from './http'
import type { QuickSlot } from '../lib/quickMessages'

// Journal de l'enfant (NAR-152).
export type JournalFilter = 'all' | 'calls' | 'blocked' | 'messages'
export type JournalItem =
  | { id: string, kind: 'call_out' | 'call_in' | 'call_blocked', at: string, contactId: string | null, name: string | null, phone: string | null, durationS: number | null }
  | { id: string, kind: 'unlock', at: string, source: 'code' | 'remote', durationS: number | null }
  | { id: string, kind: 'message', at: string, slot: QuickSlot, readBy: { name: string, readAt: string }[], readByMe: boolean }

// counts : sur la première page seulement (pas de curseur).
export interface JournalPage { items: JournalItem[], next: string | null, counts?: { blocked: number } }

// counts : compteur « Bloqués » demandé (écran Journal seulement, pas l'accueil).
export const getJournal = (childId: string, { kind = 'all', before, limit = 30, counts = false }: { kind?: JournalFilter, before?: string | null, limit?: number, counts?: boolean } = {}) =>
  api.get<JournalPage>(`/children/${encodeURIComponent(childId)}/journal?kind=${kind}&limit=${limit}${counts ? '&counts=1' : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
