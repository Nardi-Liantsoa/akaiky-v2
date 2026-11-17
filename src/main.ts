import { createApp } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar } from '@capacitor/status-bar'
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
}

createApp(App).use(router).mount('#app')

// Confirme au plugin OTA que ce bundle démarre. Jamais derrière un await
// réseau : sans cet appel à temps, le bundle est annulé au lancement suivant.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady().catch(() => {})
}
