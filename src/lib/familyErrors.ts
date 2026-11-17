import { ApiError } from '../api/http'
import type { Messages } from '../i18n/messages'
import { errorText } from './errors'

// Messages traduits des refus métier de la famille (codes stables du serveur).
export function familyErrorText(e: unknown, t: Messages): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_email') return t.family.invalidEmail
    if (e.code === 'last_owner') return t.family.lastOwner
    if (e.code === 'already_member') return t.family.alreadyMember
    if (e.code === 'too_many_invitations') return t.family.tooManyInvites
    if (e.code === 'invite_invalid') return t.invite.invalid
    if (e.code === 'invite_other_account') return t.invite.otherAccount
    if (e.code === 'already_in_family') return t.invite.alreadyInFamily
  }
  return errorText(e, t)
}
