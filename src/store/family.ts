import { reactive, watch } from 'vue'
import { ApiError } from '../api/http'
import { getMyFamily, type Family } from '../api/families'
import { auth, setUser } from './auth'

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

// Utilisateur pour lequel l'état ci-dessus vaut, et numéro du dernier
// chargement lancé : seule la réponse du plus récent est appliquée.
let loadedFor: string | null = null
let generation = 0
let pending: Promise<void> | null = null

function resetIfOtherUser() {
  const id = auth.user?.id ?? null
  if (id === loadedFor) return
  loadedFor = id
  generation++
  pending = null
  Object.assign(family, { status: 'unknown', data: null, error: null })
}
// Changement de compte (déconnexion, autre connexion) : l'état du précédent
// disparaît aussitôt, avant que la moindre vue ne le lise.
watch(() => auth.user?.id, resetIfOtherUser, { flush: 'sync' })

export function loadFamily(force = false): Promise<void> {
  resetIfOtherUser()
  if (!auth.user) return Promise.resolve()
  if (!force && (family.status === 'ready' || family.status === 'none')) return Promise.resolve()
  if (!force && pending) return pending
  const mine = ++generation
  // Rechargement : l'écran garde l'état connu pendant l'appel (pas de clignotement).
  if (family.status === 'unknown' || family.status === 'error') family.status = 'loading'
  const run: Promise<void> = getMyFamily().then(
    (data) => {
      if (mine === generation) Object.assign(family, { status: 'ready', data, error: null })
    },
    (e: unknown) => {
      if (mine !== generation) return
      // Session expirée ou révoquée : c'est une déconnexion, pas une panne. Le
      // routeur (import différé : il dépend de ce module) renvoie vers la connexion.
      if (e instanceof ApiError && e.status === 401) {
        setUser(null)
        void import('../router').then(({ router }) =>
          router.replace({ name: 'connexion', query: { next: router.currentRoute.value.fullPath } }))
        return
      }
      const none = e instanceof ApiError && e.status === 404 && e.code === 'no_family'
      if (none) Object.assign(family, { status: 'none', data: null, error: null })
      // Rechargement en échec (réseau, serveur) : la famille connue reste affichée.
      else if (family.data) family.error = e
      else Object.assign(family, { status: 'error', data: null, error: e })
    }
  ).finally(() => { if (pending === run) pending = null })
  pending = run
  return run
}

// Nom renvoyé par le serveur après un renommage : appliqué sans recharger.
export function setFamilyName(name: string) {
  if (family.data) family.data.name = name
}

export const canManage = () => family.data?.role === 'owner' || family.data?.role === 'manager'
