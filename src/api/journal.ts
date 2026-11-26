import { api } from './http'
import type { QuickSlot } from '../lib/quickMessages'

// Journal de l'enfant (NAR-152).
// Liste et type tirés l'un de l'autre : un filtre ajouté ici vaut aussi pour ?kind= (NAR-227).
export const JOURNAL_FILTERS = ['all', 'calls', 'blocked', 'messages', 'unlocks'] as const
export type JournalFilter = (typeof JOURNAL_FILTERS)[number]
export type JournalItem =
  // emergencyWindow (NAR-196) : appel reçu laissé sonner par la fenêtre des secours.
  | { id: string, kind: 'call_out' | 'call_in' | 'call_blocked', at: string, contactId: string | null, name: string | null, phone: string | null, durationS: number | null, emergencyWindow?: boolean }
  | { id: string, kind: 'unlock', at: string, source: 'code' | 'remote', durationS: number | null }
  | { id: string, kind: 'message', at: string, slot: QuickSlot, text?: string | null, readBy: { name: string, readAt: string }[], readByMe: boolean }

// today : nombres du jour (heure de Madagascar) pour les tuiles de synthèse (NAR-175).
export interface JournalToday { calls: number, blocked: number, messages: number, unlocks: number }
export interface JournalPage { items: JournalItem[], next: string | null, today?: JournalToday }

// counts : nombres du jour demandés (écran Journal, au premier chargement d'un enfant).
// day : un seul jour « AAAA-MM-JJ » (heure de Madagascar, NAR-233), ou « today » (le jour du serveur,
// NAR-244) ; les nombres sont alors les siens. Sans day : tous les jours (accueil).
export const getJournal = (childId: string, { kind = 'all', before, limit = 30, counts = false, day }: { kind?: JournalFilter, before?: string | null, limit?: number, counts?: boolean, day?: string } = {}) =>
  api.get<JournalPage>(`/children/${encodeURIComponent(childId)}/journal?kind=${kind}&limit=${limit}${counts ? '&counts=1' : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}${day ? `&day=${day}` : ''}`)
