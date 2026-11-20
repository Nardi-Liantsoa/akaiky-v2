/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}

// `updateUrl` du greffon OTA lu au build dans capacitor.config.ts (vite.config.ts, NAR-191) :
// vide tant que les coques visent Capgo Cloud (aucune vérification n'est alors faite).
declare const __AKAIKY_OTA_UPDATE_URL__: string
