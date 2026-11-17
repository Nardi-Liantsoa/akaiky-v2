import { reactive, watch } from 'vue'
import { ApiError } from '../api/http'
import { listContacts, type Contact } from '../api/contacts'
import { auth, setUser } from './auth'
import { family } from './family'

// Contacts autorisés de l'enfant affiché dans Réglages. L'état vaut pour un
// compte, une famille et un enfant ; seule la réponse du dernier chargement
// lancé est appliquée.
export const contacts = reactive({
  childId: null as string | null,
  status: 'unknown' as 'unknown' | 'loading' | 'ready' | 'error',
  items: [] as Contact[],
  max: 6,
  version: 0,
  error: null as unknown
})

let scope: string | null = null
let generation = 0

const currentScope = (childId: string | null) => (auth.user && childId ? `${auth.user.id}:${family.data?.id ?? ''}:${childId}` : null)
function reset(next: string | null, childId: string | null) {
  scope = next
  generation++
  Object.assign(contacts, { childId, status: 'unknown', items: [], max: 6, version: 0, error: null })
}
// Changement de compte ou de famille : la liste affichée disparaît aussitôt.
watch(() => currentScope(contacts.childId), (s) => { if (s !== scope) reset(s, s ? contacts.childId : null) }, { flush: 'sync' })

export async function loadContacts(childId: string, force = false): Promise<void> {
  const s = currentScope(childId)
  if (s !== scope) reset(s, childId)
  if (!s || (!force && contacts.status === 'ready')) return
  const mine = ++generation
  if (contacts.status !== 'ready') contacts.status = 'loading'
  try {
    const list = await listContacts(childId)
    if (mine !== generation) return
    Object.assign(contacts, { status: 'ready', items: list.contacts, max: list.max, version: list.version, error: null })
  } catch (e) {
    if (mine !== generation) return
    if (e instanceof ApiError && e.status === 401) { setUser(null); return }
    if (contacts.status === 'ready') contacts.error = e
    else Object.assign(contacts, { status: 'error', error: e })
  }
}
