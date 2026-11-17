import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { auth, init, isAdmin } from './store/auth'

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
      { path: 'journal', name: 'journal', component: () => import('./views/parent/LogView.vue') },
      { path: 'reglages', name: 'reglages', component: () => import('./views/parent/SettingsView.vue') },
      { path: 'famille', name: 'famille', component: () => import('./views/parent/FamilyView.vue') }
    ]
  },
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
  await init()
  if (to.meta.requiresAuth && !auth.user) return { name: 'connexion', query: { next: to.fullPath } }
  if (to.meta.requiresAdmin && !isAdmin()) return { name: 'espace' }
  // Un lien de confirmation ou de réinitialisation s'ouvre même connecté.
  if (to.meta.guestOnly && auth.user && !/^#(reset|confirm)=/.test(to.hash)) return { name: 'espace' }
  return true
})
