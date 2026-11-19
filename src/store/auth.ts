import { reactive } from 'vue'
import { api, json, ApiError } from '../api/http'
import { login as transportLogin, logout as transportLogout } from '../api/transport'
import type { LoginResult, User } from '../api/types'

// Session de l'utilisateur, état global. `init()` est attendu par la première
// garde du routeur : un rechargement sur une route protégée ne renvoie pas
// vers la connexion pendant que la session se restaure.
export const auth = reactive({
  user: null as User | null,
  ready: false,
  // Session non vérifiable au démarrage (réseau coupé ou serveur indisponible) :
  // on ne déconnecte pas, on propose de réessayer avec le bon message.
  offline: false as false | 'network' | 'server'
})

let pending: Promise<void> | null = null

// Nouvel essai après un démarrage hors ligne (bouton « Réessayer ») : la
// session n'a pas été perdue, on n'en ouvre pas une seconde.
export function retry(): Promise<void> {
  auth.ready = false
  auth.offline = false
  pending = null
  return init()
}

export function init(): Promise<void> {
  if (auth.ready) return Promise.resolve()
  pending ??= (async () => {
    try {
      auth.user = (await api.get<{ user: User | null }>('/auth/me')).user
    } catch (e) {
      // Réseau coupé ou serveur indisponible (déploiement, surcharge) : ce n'est
      // pas une déconnexion, seul un 401 en est une. On propose de réessayer.
      auth.offline = !(e instanceof ApiError) ? false
        : e.status === 0 ? 'network'
        : e.status === 429 || e.status >= 500 ? 'server' : false
      auth.user = null
    }
    auth.ready = true
  })()
  return pending
}

export async function login(email: string, password: string, rememberDevice = false): Promise<LoginResult> {
  const result = await transportLogin(json, { email, password, rememberDevice })
  auth.offline = false
  auth.user = result.user ?? null
  return result
}

// Fin du second facteur : le serveur ouvre la session.
export function setUser(user: User | null) {
  auth.offline = false
  auth.user = user
}

// consent : case « majeur·e, autorité parentale » cochée (NAR-178).
export async function register(name: string, email: string, password: string): Promise<void> {
  await api.post('/auth/register', { name, email, password, consent: true })
}

export async function logout(): Promise<void> {
  try { await transportLogout(json) } finally { auth.user = null; auth.offline = false }
}

// Le rôle est attribué côté serveur ; ici il ne sert qu'à afficher le lien
// d'administration. Chaque route admin est vérifiée par l'API.
export const isAdmin = () => !!auth.user?.is_admin
