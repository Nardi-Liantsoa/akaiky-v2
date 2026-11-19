import { send } from './transport'

// Erreur d'API : statut HTTP (0 = réseau) et message du serveur, en français.
// Les vues affichent leur propre message traduit selon le statut (errorText) ;
// le texte du serveur ne sert qu'en dernier recours, pour un 400 de validation.
// `code` : identifiant stable renvoyé par le serveur pour les cas que le front
// doit distinguer (ex. 'web_only') ; le message, lui, peut changer.
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message) }
}

export async function json<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  // Content-Type seulement avec un corps : un DELETE annoncé JSON mais vide est refusé.
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await send(path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'network')
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null
  if (!res.ok) throw new ApiError(res.status, data?.error || '', typeof data?.code === 'string' ? data.code : undefined)
  return data as T
}

export const api = {
  get: <T>(path: string) => json<T>(path),
  post: <T>(path: string, body?: unknown) => json<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => json<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => json<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) => json<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) })
}
