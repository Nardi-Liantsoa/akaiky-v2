import type { CapacitorConfig } from '@capacitor/cli'
import { loadEnv } from 'vite'

// Origine de l'API, donc du serveur OTA (NAR-190) : la même que celle compilée dans le bundle
// (src/api/base.ts, VITE_API_ORIGIN), lue par Vite comme pour un build de production (variable
// d'environnement, puis .env.production.local, .env.production, .env.local, .env) ; à défaut
// l'adresse provisoire, tant que le domaine n'est pas choisi. `cap sync` et `vite build` sont deux
// processus : chacun relit ces mêmes sources, et le build Android vérifie qu'ils concordent
// (android/app/build.gradle, OtaIdentityTask : l'origine doit figurer dans le bundle embarqué).
export const PLACEHOLDER_ORIGIN = 'https://akaiky.a-definir.invalid'
export function apiOrigin(env: Record<string, string | undefined> = loadEnv('production', process.cwd(), 'VITE_')): string {
  return env.VITE_API_ORIGIN || PLACEHOLDER_ORIGIN
}
// Origine canonique (minuscules, sans port par défaut) : la forme que vérifient vite.config.ts et
// le build Android. Refusée : autre chose qu'une origine http(s) sans chemin, ou Capgo Cloud.
export function normalizeOrigin(raw: string): string {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error(`Origine de l'API invalide : ${raw}`) }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash
    || u.origin !== raw.replace(/\/$/, '').toLowerCase().replace(/:443$|:80$/, '') || raw.endsWith('/')) {
    throw new Error(`Origine de l'API invalide : ${raw} (https://<hôte>, sans chemin)`)
  }
  const host = u.hostname
  if (host === 'capgo.app' || host.endsWith('.capgo.app')) throw new Error('Le serveur OTA ne peut pas être Capgo Cloud')
  return u.origin
}
// Adresses du serveur OTA (server/src/routes/ota.js). Le chargement de ce fichier (aussi par
// `npm run dev` et les tests) accepte une API locale en http ; le build Android décide de ce qu'une
// coque peut embarquer : release, https et jamais l'adresse provisoire ; debug, https ou
// http://127.0.0.1:<port> (seul hôte en clair de la coque debug, essai par adb reverse).
export const OTA_UPDATE_PATH = '/api/ota/latest'
export const OTA_CHANNEL_PATH = '/api/ota/channel'
export function otaUrls(raw: string) {
  const origin = normalizeOrigin(raw)
  return { updateUrl: `${origin}${OTA_UPDATE_PATH}`, channelUrl: `${origin}${OTA_CHANNEL_PATH}`, httpsOnly: origin.startsWith('https://') }
}
const ota = otaUrls(apiOrigin())

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
      statsUrl: '',
      // Serveur OTA Akaiky (NAR-189, NAR-190), jamais Capgo Cloud (plugin.capgo.app par défaut).
      // Le JavaScript ne peut ni les changer (setUpdateUrl, setChannelUrl, setStatsUrl refusés), ni
      // en garder une autre au redémarrage, ni demander les mises à jour d'une autre app (aperçu).
      updateUrl: ota.updateUrl,
      channelUrl: ota.channelUrl,
      allowModifyUrl: false,
      persistModifyUrl: false,
      allowPreview: false,
      httpsOnly: ota.httpsOnly,
      allowHttpsToHttpRedirect: false
    }
  }
}

export default config
