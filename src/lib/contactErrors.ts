import { ApiError } from '../api/http'
import type { Messages } from '../i18n/messages'
import { errorText } from './errors'

// Refus métier des contacts, traduits (codes stables du serveur).
export function contactErrorText(e: unknown, t: Messages): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_phone') return t.contacts.invalidPhone
    if (e.code === 'duplicate_phone') return t.contacts.duplicate
    if (e.code === 'too_many_contacts') return t.contacts.tooMany
    if (e.code === 'order_mismatch') return t.contacts.changed
    if (e.code === 'contact_not_found') return t.contacts.notFound
    if (e.code === 'member_not_found') return t.contacts.memberGone
    if (e.code === 'member_already_linked') return t.contacts.memberLinked
    if (e.code === 'child_not_found') return t.children.notFound
  }
  return errorText(e, t)
}
