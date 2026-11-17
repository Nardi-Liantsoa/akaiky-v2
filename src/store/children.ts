import { reactive, watch } from 'vue'
import { listChildren, type Child } from '../api/children'
import { auth } from './auth'

// Enfants de la famille de la session et enfant sélectionné sur l'accueil.
// La sélection est retenue sur l'appareil (préférence d'affichage, pas une
// donnée de la famille) : valeur relue = entrée non fiable, validée contre la
// liste ; le choix par défaut (premier enfant) n'est jamais écrit.
const KEY = 'akaiky-v2.child'

export const children = reactive({
  status: 'unknown' as 'unknown' | 'loading' | 'ready' | 'error',
  items: [] as Child[],
  error: null as unknown,
  selectedId: null as string | null
})

let loadedFor: string | null = null
let generation = 0

function stored(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

function resetIfOtherUser() {
  const id = auth.user?.id ?? null
  if (id === loadedFor) return
  loadedFor = id
  generation++
  Object.assign(children, { status: 'unknown', items: [], error: null, selectedId: null })
}
watch(() => auth.user?.id, resetIfOtherUser, { flush: 'sync' })

function settleSelection() {
  const wanted = children.selectedId ?? stored()
  children.selectedId = children.items.find((c) => c.id === wanted)?.id ?? children.items[0]?.id ?? null
}

export async function loadChildren(force = false): Promise<void> {
  resetIfOtherUser()
  if (!auth.user) return
  if (!force && children.status === 'ready') return
  const mine = ++generation
  if (children.status !== 'ready') children.status = 'loading'
  try {
    const items = await listChildren()
    if (mine !== generation) return
    Object.assign(children, { status: 'ready', items, error: null })
    settleSelection()
  } catch (e) {
    if (mine !== generation) return
    // Rechargement en échec : la liste connue reste affichée.
    if (children.status === 'ready') children.error = e
    else Object.assign(children, { status: 'error', error: e })
  }
}

export function selectChild(id: string) {
  if (!children.items.some((c) => c.id === id)) return
  children.selectedId = id
  try {
    if (id === children.items[0]?.id) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, id)
  } catch { /* stockage indisponible : sélection gardée pour la session */ }
}

export const selectedChild = () => children.items.find((c) => c.id === children.selectedId) ?? null
