import { reactive, watch } from 'vue'
import { ApiError } from '../api/http'
import { listChildren, type Child } from '../api/children'
import { auth, setUser } from './auth'
import { family } from './family'

// Enfants de la famille de la session et enfant sélectionné sur l'accueil.
// La sélection est retenue sur l'appareil, par compte (préférence d'affichage,
// pas une donnée de la famille) : valeur relue = entrée non fiable, validée
// contre la liste ; le choix par défaut (premier enfant) n'est jamais écrit.
const key = () => `akaiky-v2.child.${auth.user?.id ?? ''}`

export const children = reactive({
  status: 'unknown' as 'unknown' | 'loading' | 'ready' | 'error',
  items: [] as Child[],
  error: null as unknown,
  selectedId: null as string | null,
  // Ordre des cartes de l'accueil tel qu'affiché (NAR-193, `sortBySeverity`) : gardé hors du
  // composant pour qu'un retour sur l'accueil reparte du même ordre, sans saut pendant que
  // les états des téléphones sont relus. Préférence d'affichage, jamais écrite sur l'appareil.
  order: [] as string[]
})

let loadedFor: string | null = null
let generation = 0
let pending: Promise<void> | null = null

function stored(): string | null {
  try { return localStorage.getItem(key()) } catch { return null }
}

// L'état vaut pour un compte ET une famille : quitter une famille puis en
// rejoindre une autre ne montre jamais les enfants de la précédente.
const scope = () => (auth.user ? `${auth.user.id}:${family.data?.id ?? ''}` : null)
function resetIfOtherScope() {
  const s = scope()
  if (s === loadedFor) return
  loadedFor = s
  generation++
  pending = null
  Object.assign(children, { status: 'unknown', items: [], error: null, selectedId: null, order: [] })
}
watch(scope, resetIfOtherScope, { flush: 'sync' })

function settleSelection() {
  const wanted = children.selectedId ?? stored()
  children.selectedId = children.items.find((c) => c.id === wanted)?.id ?? children.items[0]?.id ?? null
}

export function loadChildren(force = false): Promise<void> {
  resetIfOtherScope()
  if (!auth.user || !family.data) return Promise.resolve()
  if (!force && children.status === 'ready') return Promise.resolve()
  // Un chargement en cours sert aux appelants ordinaires ; un rechargement forcé
  // veut un état postérieur à l'appel, il repart d'une requête neuve.
  if (!force && pending) return pending
  const mine = ++generation
  if (children.status !== 'ready') children.status = 'loading'
  const run: Promise<void> = listChildren().then(
    (items) => {
      if (mine !== generation) return
      Object.assign(children, { status: 'ready', items, error: null })
      settleSelection()
    },
    (e: unknown) => {
      if (mine !== generation) return
      // Session expirée ou révoquée : déconnexion (le routeur et la coquille
      // renvoient vers la connexion), pas une panne à réessayer.
      if (e instanceof ApiError && e.status === 401) { setUser(null); return }
      // Rechargement en échec : la liste connue reste affichée.
      if (children.status === 'ready') children.error = e
      else Object.assign(children, { status: 'error', error: e })
    }
  ).finally(() => { if (pending === run) pending = null })
  pending = run
  return run
}

// Une liste demandée avant une modification locale est périmée : elle est
// ignorée, pour ne pas défaire l'ajout, la modification ou le retrait. Elle n'est
// redemandée que si aucune liste n'est encore connue (l'accueil relit de toute façon).
function invalidateInFlight() {
  if (!pending) return
  generation++
  pending = null
  if (children.status !== 'ready') void loadChildren(true)
}

// Réponse du serveur appliquée tout de suite (ajout ou modification), sans attendre un rechargement.
export function upsertChild(child: Child) {
  invalidateInFlight()
  const i = children.items.findIndex((c) => c.id === child.id)
  children.items = i === -1 ? [...children.items, child] : children.items.map((c) => (c.id === child.id ? child : c))
}

// Enfant retiré : il disparaît de la liste et de la sélection retenue.
export function dropChild(id: string) {
  invalidateInFlight()
  children.items = children.items.filter((c) => c.id !== id)
  try { if (localStorage.getItem(key()) === id) localStorage.removeItem(key()) } catch { /* rien à effacer */ }
  if (children.selectedId === id) children.selectedId = null
  settleSelection()
}

export function selectChild(id: string) {
  if (!children.items.some((c) => c.id === id)) return
  children.selectedId = id
  try {
    if (id === children.items[0]?.id) localStorage.removeItem(key())
    else localStorage.setItem(key(), id)
  } catch { /* stockage indisponible : sélection gardée pour la session */ }
}

export const selectedChild = () => children.items.find((c) => c.id === children.selectedId) ?? null
