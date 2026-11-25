import { closeAllSheets } from './composables/useSheetStack'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { auth, init, isAdmin } from './store/auth'
import { family, loadFamily } from './store/family'
import { appKind } from './lib/appKind'
import { SETTINGS_SECTIONS } from './lib/settingsSections'

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
    // parentShell : écrans de la coquille, où la barre d'onglets est la seule navigation
    // (pas d'en-tête global, App.vue).
    meta: { requiresAuth: true, parentShell: true },
    children: [
      // wide : colonne large sur ordinateur (grille de l'accueil, maître/détail de Réglages, NAR-223).
      { path: '', name: 'espace', component: () => import('./views/parent/HomeView.vue'), meta: { wide: true } },
      // requiresFamily : sans famille, retour à l'accueil, qui présente la création.
      { path: 'journal', name: 'journal', component: () => import('./views/parent/LogView.vue'), meta: { requiresFamily: true } },
      {
        // Réglages (NAR-185) : un résumé, puis une page par section ; le cadre (enfant
        // affiché, chargements) reste monté de l'une à l'autre. meta fusionnée : la garde
        // requiresFamily vaut pour chaque page.
        path: 'reglages',
        component: () => import('./views/parent/SettingsLayout.vue'),
        meta: { requiresFamily: true, wide: true },
        children: [
          { path: '', name: 'reglages', component: () => import('./views/parent/SettingsView.vue'), meta: { requiresFamily: true } },
          ...SETTINGS_SECTIONS.map((s) => ({
            path: s.path,
            name: s.route,
            component: () => import('./views/parent/SettingsSectionView.vue'),
            meta: { requiresFamily: true, settingsSection: s.key }
          }))
        ]
      },
      { path: 'famille', name: 'famille', component: () => import('./views/parent/FamilyView.vue'), meta: { requiresFamily: true } },
      // « Mon compte » (NAR-156, NAR-209 : langue, déconnexion, sécurité, suppression), ouvert depuis
      // l’onglet Famille : la page garde la barre d’onglets,
      // Famille y reste signalé. Sans requiresFamily : ouverte aussi avant la création.
      { path: 'compte/securite', name: 'securite', component: () => import('./views/SecurityView.vue') },
      { path: 'enfant/nouveau', name: 'enfant-nouveau', component: () => import('./views/parent/ChildFormView.vue'), meta: { requiresFamily: true } },
      { path: 'enfant/:id', name: 'enfant', component: () => import('./views/parent/ChildFormView.vue'), meta: { requiresFamily: true } },
      { path: 'enfant/:id/telephone', name: 'telephone', component: () => import('./views/parent/PairingView.vue'), meta: { requiresFamily: true, wide: true } },
      // Fiche contact : hors du cadre de Réglages, son retour mène à la section Contacts.
      { path: 'reglages/enfant/:childId/contact/nouveau', name: 'contact-nouveau', component: () => import('./views/parent/ContactFormView.vue'), meta: { requiresFamily: true } },
      { path: 'reglages/enfant/:childId/contact/:id', name: 'contact', component: () => import('./views/parent/ContactFormView.vue'), meta: { requiresFamily: true } }
    ]
  },
  // App enfant (variante Android « enfant ») : ses seules routes. Le téléphone de
  // l'enfant n'a pas de compte ; il s'authentifiera comme appareil (NAR-138).
  { path: '/enfant', name: 'enfant-accueil', component: () => import('./views/child/ChildHomeView.vue'), meta: { childApp: true } },
  // Ouverte sans session : la page explique comment se connecter, puis accepter.
  { path: '/invitation', name: 'invitation', component: () => import('./views/InviteView.vue') },
  // Ancienne adresse (liens, marque-pages, ?next=) : renvoyée dans la coquille parent.
  // parentShell : pas d'en-tête au premier chargement, avant que la redirection aboutisse.
  { path: '/securite', redirect: (to) => ({ name: 'securite', query: to.query, hash: to.hash }), meta: { parentShell: true } },
  { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue'), meta: { requiresAuth: true, requiresAdmin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  // Ancre éventuelle : la page s'ouvre sur cet élément.
  scrollBehavior: (to, _from, saved) => saved ?? (to.hash ? { el: to.hash, top: 8 } : { top: 0 })
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

// Nouvel écran : aucune feuille ne reste ouverte par-dessus (pile des feuilles, ampy-vue).
router.afterEach(() => { closeAllSheets() })
