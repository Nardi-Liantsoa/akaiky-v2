import { createApp } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import App from './App.vue'
import { router } from './router'
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

createApp(App).use(router).mount('#app')

// Confirme au plugin OTA que ce bundle démarre. Jamais derrière un await
// réseau : sans cet appel à temps, le bundle est annulé au lancement suivant.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady().catch(() => {})
}
