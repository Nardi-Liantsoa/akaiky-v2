// Transport de l'application native (Capacitor). Deux jetons opaques :
//   - jeton d'accès court (15 min), gardé en mémoire seulement ;
//   - jeton de renouvellement, gardé dans le Keychain (iOS) / Keystore
//     (Android) par un plugin natif — jamais dans localStorage ni Preferences.
// Le serveur tourne le jeton de renouvellement à chaque usage et ferme la
// session si un ancien est présenté : les renouvellements sont donc
// sérialisés (une seule requête à la fois, partagée par tous les appels).
import { Capacitor } from '@capacitor/core'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import type { LoginId, LoginResult } from './types'

export const native = true

import { API_BASE as BASE } from './base'
const KEY = 'refresh-token'
// Jetons de déconnexions que le serveur n'a pas pu enregistrer (hors ligne) :
// une liste (plusieurs déconnexions hors ligne possibles), relue une fois au
// démarrage, puis tenue en mémoire ; retentée avant les appels suivants.
const PENDING_REVOKE = 'refresh-tokens-revoke'
let pendingLoaded = false
let pendingTokens: string[] = []

async function savePending() {
  if (pendingTokens.length) await SecureStorage.set(PENDING_REVOKE, pendingTokens)
  else await SecureStorage.remove(PENDING_REVOKE).catch(() => {})
}

let access: string | null = null
let refreshing: Promise<boolean> | null = null

interface Tokens { accessToken: string, refreshToken: string }

async function store(t: Tokens) {
  access = t.accessToken
  await SecureStorage.set(KEY, t.refreshToken)
}

async function forget() {
  access = null
  await SecureStorage.remove(KEY).catch(() => {})
}

// Renouvelle le jeton d'accès. Faux si aucune session n'est enregistrée ou si
// le serveur la refuse (401). Une erreur réseau ou un serveur indisponible
// (503 pendant un déploiement, 429) lève une erreur : ce n'est pas une
// déconnexion, le jeton de renouvellement est gardé.
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const saved = await SecureStorage.get(KEY)
      if (typeof saved !== 'string' || !saved) return false
      const res = await fetch(`${BASE}/auth/native/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: saved })
      })
      if (res.status === 401) { await forget(); return false }
      if (!res.ok) throw new Error(`renouvellement indisponible (${res.status})`)
      await store(await res.json())
      return true
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

function call(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  if (access) headers.set('Authorization', `Bearer ${access}`)
  return fetch(`${BASE}${path}`, { ...init, headers, credentials: 'omit' })
}

let revoking: Promise<void> | null = null
function flushRevocation(): Promise<void> {
  if (pendingLoaded && !pendingTokens.length) return Promise.resolve()
  revoking ??= (async () => {
    try {
      if (!pendingLoaded) {
        const saved = await SecureStorage.get(PENDING_REVOKE)
        pendingTokens = Array.isArray(saved) ? saved.filter((t): t is string => typeof t === 'string') : []
        pendingLoaded = true
      }
      for (const token of [...pendingTokens]) {
        const res = await fetch(`${BASE}/auth/native/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token })
        })
        // 2xx : révoqué. Autre 4xx que 429 : définitif, inutile de réessayer.
        // 429 et 5xx : on garde le jeton pour plus tard.
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          pendingTokens = pendingTokens.filter((t) => t !== token)
        } else break
      }
      await savePending()
    } catch { /* toujours hors ligne : on retentera */ } finally {
      revoking = null
    }
  })()
  return revoking
}

export async function send(path: string, init: RequestInit = {}): Promise<Response> {
  await flushRevocation()
  const nativeAuth = path.startsWith('/auth/native/')
  if (!access && !nativeAuth) await refresh()
  const used = access
  let res = await call(path, init)
  // Un 401 de connexion est un mauvais mot de passe : ni renouvellement ni
  // nouvel envoi (la garde de connexion compterait deux échecs).
  if (res.status === 401 && used && !nativeAuth) {
    // Jeton d'accès expiré. Si un autre appel l'a déjà renouvelé pendant que
    // celui-ci était en route, on réessaie avec le nouveau, sans renouveler
    // une deuxième fois (chaque rotation invaliderait le jeton des autres).
    if (access !== used || await refresh()) res = await call(path, init)
  }
  return res
}

export async function login(json: (path: string, init: RequestInit) => Promise<unknown>, body: LoginId & { password: string }): Promise<LoginResult> {
  // Adresse ou numéro, celui qui est donné seulement (`undefined` n'est pas sérialisé).
  const r = await json('/auth/native/login', {
    method: 'POST',
    body: JSON.stringify({ email: body.email, phone: body.phone, password: body.password, device: Capacitor.getPlatform() })
  }) as LoginResult & Tokens
  await store(r)
  return { user: r.user }
}

// Révoque la session de l'appareil par le jeton de renouvellement : il reste
// valable quand le jeton d'accès a expiré (app rouverte après 15 minutes).
export async function logout(json: (path: string, init: RequestInit) => Promise<unknown>): Promise<void> {
  const saved = await SecureStorage.get(KEY)
  await forget()
  if (typeof saved !== 'string' || !saved) return
  try {
    await json('/auth/native/logout', { method: 'POST', body: JSON.stringify({ refreshToken: saved }) })
  } catch {
    // Serveur injoignable : l'app est déconnectée localement, et la session
    // sera révoquée côté serveur au prochain appel (flushRevocation).
    if (!pendingLoaded) {
      const prior = await SecureStorage.get(PENDING_REVOKE).catch(() => null)
      pendingTokens = Array.isArray(prior) ? prior.filter((t): t is string => typeof t === 'string') : []
      pendingLoaded = true
    }
    pendingTokens.push(saved)
    await savePending()
  }
}
