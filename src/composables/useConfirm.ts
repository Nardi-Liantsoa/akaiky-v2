import { shallowRef } from 'vue'

// Confirmation en attente (NAR-184) : ce qu'on s'apprête à supprimer et le bouton qui
// a ouvert la feuille (le focus y revient ; sur iOS un bouton touché ne prend pas le
// focus, d'où la lecture sur l'événement). Rien n'est supprimé tant que la feuille
// n'a pas émis confirm : la vue lit target pour faire l'appel, puis ferme.
export function useConfirm<T>() {
  const target = shallowRef<T | null>(null)
  const opener = shallowRef<HTMLElement | null>(null)
  function ask(value: T, event?: Event) {
    const el = event?.currentTarget
    opener.value = typeof HTMLElement !== 'undefined' && el instanceof HTMLElement ? el : null
    target.value = value
  }
  function close() { target.value = null }
  return { target, opener, ask, close }
}
