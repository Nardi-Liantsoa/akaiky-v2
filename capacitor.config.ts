import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'mg.nosytech.akaiky',
  appName: 'Akaiky',
  // Correspond à build.outDir de vite.config.ts : le même dossier est servi
  // par l'API pour le web et embarqué dans les coques.
  webDir: 'dist/web',
  android: {
    allowMixedContent: false,
    // Deux variantes (android/app/build.gradle) : `npx cap run android` lance la
    // variante parent par défaut ; l'enfant avec `--flavor enfant`.
    flavor: 'parent',
    // Le bundle vise Chrome 64 et plus (modules ES, import(), import.meta ;
    // vite.config.ts : modernTargets). Capacitor laisse passer dès 60 par défaut : un
    // WebView 60 à 63 afficherait un écran blanc figé. En dessous de 64, Capacitor charge
    // server.errorPath à la place (NAR-161 ; src/lib/webviewTarget.test.ts garde les
    // deux alignés). Ne couvre pas le WebView Huawei (com.huawei.webview), comparé à
    // minHuaweiWebViewVersion, qui suit une autre numérotation : limite documentée.
    minWebViewVersion: 64
  },
  server: {
    // Origine https://localhost : contexte sécurisé (caméra, géolocalisation…)
    // et origine que l'API attend dans NATIVE_ORIGINS. iOS : capacitor://localhost.
    androidScheme: 'https',
    // Écran de repli statique, trois langues, sans JavaScript (public/webview.html) :
    // WebView trop ancien (Android), ou page principale qui ne se charge pas (Android
    // et iOS) : son texte vaut pour les deux cas et les deux plateformes.
    errorPath: 'webview.html'
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
    // Canal par app (NAR-162, docs/MOBILE.md « Mises à jour OTA ») : valeurs de l'app parent
    // (iOS). Sur Android, chaque variante les réécrit dans ses propres assets au build
    // (android/app/build.gradle, OtaIdentityTask) : appId et canal de la coque, jamais du bundle.
    CapacitorUpdater: {
      autoUpdate: false,
      appReadyTimeout: 10000,
      defaultChannel: 'parent',
      allowSetDefaultChannel: false,
      allowModifyAppId: false,
      // Statistiques désactivées : par défaut le greffon envoie chaque lancement, avec
      // l'identifiant d'appareil, à plugin.capgo.app (service tiers, téléphones d'enfants).
      statsUrl: ''
    }
  }
}

export default config
