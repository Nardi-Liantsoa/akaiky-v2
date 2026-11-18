import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { auth, init, isAdmin } from './store/auth'
import { family, loadFamily } from './store/family'
import { appKind } from './lib/appKind'

// Les gardes servent le confort de navigation, pas la sécurité : chaque route
// d'API vérifie elle-même la session et le rôle.
const routes: RouteRecordRaw[] = [
  { path: '/', name: 'accueil', component: () => import('./views/HomeView.vue') },
  { path: '/connexion', name: 'connexion', component: () => import('./views/AuthView.vue'), meta: { guestOnly: true } },
  {
    // App parent : coquille à quatre onglets (docs/DESIGN.md). « espace » reste
    // le nom de l'accueil, cible des redirections après connexion.
    path: '/espace',
    component: () => import('./views/parent/ParentShell.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'espace', component: () => import('./views/parent/HomeView.vue') },
      // requiresFamily : sans famille, retour à l'accueil, qui présente la création.
      { path: 'journal', name: 'journal', component: () => import('./views/parent/LogView.vue'), meta: { requiresFamily: true } },
      { path: 'reglages', name: 'reglages', component: () => import('./views/parent/SettingsView.vue'), meta: { requiresFamily: true } },
      { path: 'famille', name: 'famille', component: () => import('./views/parent/FamilyView.vue'), meta: { requiresFamily: true } },
      { path: 'enfant/nouveau', name: 'enfant-nouveau', component: () => import('./views/parent/ChildFormView.vue'), meta: { requiresFamily: true } },
      { path: 'enfant/:id', name: 'enfant', component: () => import('./views/parent/ChildFormView.vue'), meta: { requiresFamily: true } },
      { path: 'enfant/:id/telephone', name: 'telephone', component: () => import('./views/parent/PairingView.vue'), meta: { requiresFamily: true } },
      { path: 'reglages/enfant/:childId/contact/nouveau', name: 'contact-nouveau', component: () => import('./views/parent/ContactFormView.vue'), meta: { requiresFamily: true } },
      { path: 'reglages/enfant/:childId/contact/:id', name: 'contact', component: () => import('./views/parent/ContactFormView.vue'), meta: { requiresFamily: true } }
    ]
  },
  // App enfant (variante Android « enfant ») : ses seules routes. Le téléphone de
  // l'enfant n'a pas de compte ; il s'authentifiera comme appareil (NAR-138).
  { path: '/enfant', name: 'enfant-accueil', component: () => import('./views/child/ChildHomeView.vue'), meta: { childApp: true } },
  // Ouverte sans session : la page explique comment se connecter, puis accepter.
  { path: '/invitation', name: 'invitation', component: () => import('./views/InviteView.vue') },
  { path: '/securite', name: 'securite', component: () => import('./views/SecurityView.vue'), meta: { requiresAuth: true } },
  { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 }
})

router.beforeEach(async (to) => {
  // Chaque application ne voit que ses écrans : l'app enfant n'atteint jamais
  // l'espace parent (ni la connexion), l'app parent jamais l'écran enfant.
  const kind = await appKind()
  if (kind === 'enfant') return to.meta.childApp ? true : { name: 'enfant-accueil' }
  if (to.meta.childApp) return { name: 'accueil' }
  await init()
  if (to.meta.requiresAuth && !auth.user) return { name: 'connexion', query: { next: to.fullPath } }
  if (to.meta.requiresAdmin && !isAdmin()) return { name: 'espace' }
  // Un lien de confirmation ou de réinitialisation s'ouvre même connecté.
  if (to.meta.guestOnly && auth.user && !/^#(reset|confirm)=/.test(to.hash)) return { name: 'espace' }
  // Parent sans famille : les onglets autres que l'accueil renvoient vers la
  // création (l'accueil la présente). Une erreur réseau n'est pas « sans famille ».
  if (to.meta.requiresFamily && auth.user) {
    await loadFamily()
    // Session perdue pendant le chargement : connexion, puis retour à la page visée.
    if (!auth.user) return { name: 'connexion', query: { next: to.fullPath } }
    if (family.status === 'none') return { name: 'espace' }
  }
  return true
})
