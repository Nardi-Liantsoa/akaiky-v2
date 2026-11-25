import { createApp } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { App as NativeApp } from '@capacitor/app'
import { appKind } from './lib/appKind'
import { startOtaRuntime } from './lib/otaRuntime'
import { syncAccountLang } from './lib/accountLang'
import { closeTopSheet } from './composables/useSheetStack'
import App from './App.vue'
import { router } from './router'

const ROOT_TABS = new Set(['espace', 'journal', 'reglages', 'famille', 'accueil'])
import './style.css'
import './mobile.css'

// En natif, on dessine sous la barre d'état pour que env(safe-area-inset-top)
// ait une valeur (sinon le contenu colle à l'encoche sur iPhone).
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('native', `platform-${Capacitor.getPlatform()}`)
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  // Interface toujours claire (pas de mode sombre, docs/DESIGN.md) : texte
  // sombre dans la barre d'état, même quand le système est en thème sombre.
  StatusBar.setStyle({ style: Style.Light }).catch(() => {})
}

// Langue des courriels du compte (NAR-211).
syncAccountLang()

createApp(App).use(router).mount('#app')

// App enfant : un seul écran, sans historique. Le bouton retour d'Android fermerait
// l'activité et sortirait l'enfant d'Akaiky ; poser un écouteur annule ce comportement.
// Écouteur unique, au niveau de l'app (aucune pile de feuilles côté enfant).
// App parent : le retour ferme d'abord la feuille du dessus (pile des feuilles), sinon
// revient en arrière dans l'app, sinon la quitte (comportement par défaut de Capacitor).
if (Capacitor.getPlatform() === 'android') {
  appKind().then((kind) => {
    if (kind === 'enfant') { NativeApp.addListener('backButton', () => {}).catch(() => {}); return }
    // Sur un onglet (racine), l'app passe en arrière-plan comme avec le retour natif
    // d'Android 12+ : jamais de retour vers la connexion, que les gardes renverraient ici.
    NativeApp.addListener('backButton', ({ canGoBack }) => {
      if (closeTopSheet()) return
      const name = router.currentRoute.value.name
      if (!canGoBack || ROOT_TABS.has(String(name))) void NativeApp.minimizeApp()
      else window.history.back()
    }).catch(() => {})
  })
}

// Confirme au plugin OTA que ce bundle démarre. Jamais derrière un await
// réseau : sans cet appel à temps, le bundle est annulé au lancement suivant.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady().catch(() => {})
  // Puis seulement, sans l'attendre : vérification OTA (NAR-191), inerte tant que les coques ne
  // visent pas le serveur Akaiky (src/lib/otaUpdate.ts, barrière Capgo).
  void appKind().then(startOtaRuntime).catch(() => {})
}
