import type { RouteLocationRaw } from 'vue-router'

// Écran ouvert au toucher d'une notification (NAR-179, ampy-push « Côté app ») : `data.type`
// lu dans une liste fermée, jamais une URL reçue. Type inconnu, absent ou mal formé : accueil.
// Le contenu se recharge par l'API avec la session (la notification ne porte que { type, id }).
const ROUTES: Record<string, RouteLocationRaw> = {
  // Message rapide de l'enfant : le journal (NAR-152).
  message: { name: 'journal' },
  // État du téléphone de l'enfant (NAR-147) : la carte de l'enfant, sur l'accueil.
  battery_low: { name: 'espace' },
  sim_absent: { name: 'espace' },
  silent: { name: 'espace' },
  test: { name: 'espace' }
}
const HOME: RouteLocationRaw = { name: 'espace' }

// SOS (NAR-249) : écran de l'alerte, identifiant vérifié (uuid) ; sinon l'accueil, qui montre
// le bandeau des alertes en cours.
const SOS_TYPES = new Set(['sos', 'sos_cancelled'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function routeForPush(data: unknown): RouteLocationRaw {
  if (!data || typeof data !== 'object') return HOME
  const type = (data as { type?: unknown }).type
  const id = (data as { id?: unknown }).id
  if (typeof type === 'string' && SOS_TYPES.has(type)) return typeof id === 'string' && UUID.test(id) ? { name: 'sos', params: { id: id.toLowerCase() } } : HOME
  return typeof type === 'string' && Object.hasOwn(ROUTES, type) ? ROUTES[type] : HOME
}

// Type d'une notification, ou null : sert aux réveils silencieux de l'app enfant.
export function pushType(data: unknown): string | null {
  const type = data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined
  return typeof type === 'string' ? type : null
}
