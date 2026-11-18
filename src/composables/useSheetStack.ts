// Pile des feuilles ouvertes (convention ampy-vue, NAR-174) : la dernière ouverte se
// ferme en premier, par Échap ou par le bouton retour d'Android (un seul écouteur pour
// toute l'app, posé dans main.ts) ; le défilement de la page est bloqué tant qu'une
// feuille est ouverte.
const stack: Array<() => void> = []

function syncScrollLock() {
  if (typeof document !== 'undefined') document.body.style.overflow = stack.length ? 'hidden' : ''
}

// Ouverture : renvoie la fonction à appeler à la fermeture (démontage compris).
export function pushSheet(close: () => void): () => void {
  stack.push(close)
  syncScrollLock()
  let popped = false
  return () => {
    if (popped) return
    popped = true
    const i = stack.lastIndexOf(close)
    if (i !== -1) stack.splice(i, 1)
    syncScrollLock()
  }
}

// Ferme la feuille du dessus ; faux si aucune n'était ouverte.
export function closeTopSheet(): boolean {
  const close = stack.at(-1)
  if (!close) return false
  close()
  return true
}

export const openSheets = () => stack.length

// Une action prend toute la vue (changement d'écran) : toutes les feuilles se ferment.
export function closeAllSheets() {
  for (const close of [...stack].reverse()) close()
}

// Échap sur ordinateur : un seul écouteur pour toute l'app.
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && closeTopSheet()) e.preventDefault() })
}
