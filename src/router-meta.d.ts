// Champs `meta` des routes (src/router.ts). Fichier module à part : dans
// vite-env.d.ts, l'import rendrait locales les déclarations globales.
import 'vue-router'
import type { SettingsSection } from './lib/settingsSections'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    guestOnly?: boolean
    requiresFamily?: boolean
    childApp?: boolean
    parentShell?: boolean
    // Page d'une section de Réglages (NAR-185).
    settingsSection?: SettingsSection
    // Colonne large sur ordinateur : grille de l'accueil, maître/détail de Réglages (NAR-223).
    wide?: boolean
  }
}
