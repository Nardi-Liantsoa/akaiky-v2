import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { backTo } from './navigation'

const empty = { render: () => null }
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/journal', name: 'journal', component: empty },
      { path: '/reglages', name: 'reglages', component: empty },
      { path: '/reglages/contacts', name: 'contacts', component: empty },
      { path: '/reglages/contact/nouveau', name: 'fiche', component: empty }
    ]
  })
}
// L'historique mémoire de vue-router ne garde pas `back` (l'historique du navigateur, si) :
// il est simulé ici, à la frontière, comme le navigateur l'écrit.
function withBack(router: ReturnType<typeof makeRouter>, back: string | null) {
  Object.defineProperty(router.options.history, 'state', { get: () => ({ back }), configurable: true })
}

describe('backTo', () => {
  it('venu de l’écran visé : retour dans l’historique, sans nouvelle entrée', async () => {
    const router = makeRouter()
    await router.push('/reglages/contacts')
    await router.push('/reglages/contact/nouveau')
    withBack(router, '/reglages/contacts')
    const back = vi.spyOn(router, 'back')
    const replace = vi.spyOn(router, 'replace')
    await backTo(router, { name: 'contacts' })
    expect(back).toHaveBeenCalledOnce()
    expect(replace).not.toHaveBeenCalled()
  })

  it('arrivé d’ailleurs (autre écran, ou adresse ouverte directement) : l’écran visé remplace l’écran courant', async () => {
    for (const previous of ['/journal', null]) {
      const router = makeRouter()
      await router.push('/reglages/contact/nouveau')
      withBack(router, previous)
      const back = vi.spyOn(router, 'back')
      await backTo(router, { name: 'contacts' })
      expect(back).not.toHaveBeenCalled()
      expect(router.currentRoute.value.path).toBe('/reglages/contacts')
    }
  })
})
