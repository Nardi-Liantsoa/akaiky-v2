import { ref, shallowRef } from 'vue'

// Liste paginée par curseur (back-office, NAR-144) : première page, « Afficher plus »
// tant que le serveur rend un curseur `next`. État propre à chaque appel (un par liste).
// Une erreur garde les éléments déjà chargés ; un chargement en cours n'est pas doublé.
export function usePagedList<T>(fetchPage: (before: string | null) => Promise<{ items: T[], next: string | null }>) {
  // shallowRef : la liste est remplacée en entier, jamais modifiée en place.
  const items = shallowRef<T[]>([])
  const next = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<unknown>(null)
  const loaded = ref(false)

  async function load(more = false) {
    // « Afficher plus » sans page suivante : rien à charger (sinon la première page serait rajoutée).
    if (loading.value || (more && !next.value)) return
    loading.value = true
    error.value = null
    try {
      const page = await fetchPage(more ? next.value : null)
      items.value = more ? [...items.value, ...page.items] : page.items
      next.value = page.next
      loaded.value = true
    } catch (e) {
      error.value = e
    } finally {
      loading.value = false
    }
  }

  return { items, next, loading, error, loaded, reload: () => load(false), more: () => load(true) }
}
