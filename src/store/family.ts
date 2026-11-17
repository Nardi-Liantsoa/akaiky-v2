import { reactive } from 'vue'
import { ApiError } from '../api/http'
import { getMyFamily, type Family } from '../api/families'
import { auth } from './auth'

// Famille de la session, état global (une seule famille par compte en v1).
// `none` : le parent n'a pas encore créé sa famille (404 no_family) ;
// `error` : réseau ou serveur indisponible — ce n'est PAS « pas de famille »,
// on n'envoie donc pas le parent vers la création.
export type FamilyStatus = 'unknown' | 'loading' | 'ready' | 'none' | 'error'

export const family = reactive({
  status: 'unknown' as FamilyStatus,
  data: null as Family | null,
  error: null as unknown
})

// Utilisateur pour lequel l'état ci-dessus a été chargé : un changement de
// compte (déconnexion, autre connexion) l'invalide.
let loadedFor: string | null = null
let pending: Promise<void> | null = null

function resetIfOtherUser() {
  const id = auth.user?.id ?? null
  if (id !== loadedFor) {
    loadedFor = id
    pending = null
    Object.assign(family, { status: 'unknown', data: null, error: null })
  }
}

export function loadFamily(force = false): Promise<void> {
  resetIfOtherUser()
  if (!auth.user) return Promise.resolve()
  if (!force && (family.status === 'ready' || family.status === 'none')) return Promise.resolve()
  if (!force && pending) return pending
  const forUser = loadedFor
  family.status = 'loading'
  const run: Promise<void> = getMyFamily().then(
    (data) => {
      if (loadedFor === forUser) Object.assign(family, { status: 'ready', data, error: null })
    },
    (e: unknown) => {
      if (loadedFor !== forUser) return
      const none = e instanceof ApiError && e.status === 404 && e.code === 'no_family'
      Object.assign(family, { status: none ? 'none' : 'error', data: null, error: none ? null : e })
    }
  ).finally(() => { if (pending === run) pending = null })
  pending = run
  return run
}

export const canManage = () => family.data?.role === 'owner' || family.data?.role === 'manager'
