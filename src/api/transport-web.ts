// Transport du navigateur : l'API est servie par la même origine que le site.
// La session vit dans un cookie HttpOnly que ce code ne peut pas lire ; aucun
// jeton n'est stocké côté JavaScript. L'en-tête X-App accompagne chaque
// requête : le serveur refuse toute écriture qui ne l'a pas (protection CSRF).
import type { LoginId, LoginResult } from './types'

export const native = false

export function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-App', '1')
  return fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' })
}

export async function login(json: (path: string, init: RequestInit) => Promise<unknown>, body: LoginId & { password: string, rememberDevice: boolean }): Promise<LoginResult> {
  return await json('/auth/login', { method: 'POST', body: JSON.stringify(body) }) as LoginResult
}

export async function logout(json: (path: string, init: RequestInit) => Promise<unknown>): Promise<void> {
  await json('/auth/logout', { method: 'POST' })
}
