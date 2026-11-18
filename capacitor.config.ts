import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'mg.nosytech.akaiky',
  appName: 'Akaiky',
  // Correspond à build.outDir de vite.config.ts : le même dossier est servi
  // par l'API pour le web et embarqué dans les coques.
  webDir: 'dist/web',
  android: {
    allowMixedContent: false
  },
  server: {
    // Origine https://localhost : contexte sécurisé (caméra, géolocalisation…)
    // et origine que l'API attend dans NATIVE_ORIGINS. iOS : capacitor://localhost.
    androidScheme: 'https'
  },
  plugins: {
    // Interface toujours claire (docs/DESIGN.md) : icônes sombres dans les deux barres
    // système, même en thème sombre. Sinon Capacitor suit le système, et la barre de
    // navigation à 3 boutons devient illisible sur fond clair (constaté sur Android 14).
    SystemBars: {
      style: 'LIGHT'
    },
    // Mises à jour OTA (@capgo/capacitor-updater) pilotées par le code ; un
    // bundle qui n'appelle pas notifyAppReady() à temps est annulé au lancement suivant.
    CapacitorUpdater: {
      autoUpdate: false,
      appReadyTimeout: 10000
    }
  }
}

export default config
