// Champs `meta` des routes (src/router.ts). Fichier module à part : dans
// vite-env.d.ts, l'import rendrait locales les déclarations globales.
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    guestOnly?: boolean
  }
}
