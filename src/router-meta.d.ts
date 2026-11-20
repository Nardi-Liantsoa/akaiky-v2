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
  }
}
