import type { RouteLocationRaw, Router } from 'vue-router'

// Retour vers un écran parent (NAR-185) : si l'écran précédent de l'historique est
// celui-là, on y revient (même effet que le retour Android, pas de doublon dans
// l'historique) ; sinon (adresse ouverte directement, arrivée d'un autre onglet),
// l'écran courant est remplacé par lui.
export async function backTo(router: Router, to: RouteLocationRaw): Promise<void> {
  const target = router.resolve(to).fullPath
  if (router.options.history.state.back === target) {
    router.back()
    return
  }
  await router.replace(to)
}
