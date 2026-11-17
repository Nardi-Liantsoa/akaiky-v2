// Redirection après connexion (?next=) : seulement vers une route interne
// connue. Jamais une URL qui commence par « // » (autre site) ni qui contient
// « \ » (que certains navigateurs lisent comme « / »).
const INTERNAL = /^\/(espace|securite|admin)(\/[A-Za-z0-9._~\-/]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/

export function safeNext(value: unknown, fallback = '/espace'): string {
  if (typeof value !== 'string' || value.startsWith('//') || value.includes('\\') || !INTERNAL.test(value)) return fallback
  return value
}
