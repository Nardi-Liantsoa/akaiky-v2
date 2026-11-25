import { onBeforeUnmount, ref, type Ref } from 'vue'

// Point de rupture lu en direct (NAR-223) : vrai tant que la requête correspond, suivi au
// redimensionnement. Sans matchMedia (tests sans DOM, rendu serveur) : faux, la mise en page
// téléphone, qui marche partout. Écouteur retiré au démontage du composant.
export function useMediaQuery(query: string): Ref<boolean> {
  const list = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query) : null
  const matches = ref(list?.matches ?? false)
  if (!list) return matches
  const update = (e: MediaQueryListEvent) => { matches.value = e.matches }
  list.addEventListener('change', update)
  onBeforeUnmount(() => list.removeEventListener('change', update))
  return matches
}

// Ordinateur : barre latérale, grilles et maître/détail (audit UI du 25/11/2026).
export const DESKTOP = '(min-width: 1024px)'
