// Jeton d'invitation : arrive dans le fragment (#invite=…), jamais dans la query,
// pour n'atteindre ni les journaux ni le Referer. Il est retiré de la barre
// d'adresse aussitôt lu et gardé pour l'onglet seulement (sessionStorage), le
// temps de se connecter. Valeur relue = entrée non fiable, validée.
const KEY = 'akaiky-v2.invite'
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/

export function takeInviteToken(): string | null {
  const m = /^#invite=([A-Za-z0-9_-]{20,100})$/.exec(location.hash)
  if (m) {
    try { sessionStorage.setItem(KEY, m[1]) } catch { /* stockage indisponible : jeton gardé en mémoire */ }
    history.replaceState(history.state, '', location.pathname + location.search)
    return m[1]
  }
  try {
    const saved = sessionStorage.getItem(KEY)
    return saved && TOKEN.test(saved) ? saved : null
  } catch { return null }
}

export function forgetInviteToken() {
  try { sessionStorage.removeItem(KEY) } catch { /* rien à effacer */ }
}
