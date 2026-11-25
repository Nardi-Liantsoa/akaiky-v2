import { ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import type { RouteLocationRaw, Router } from 'vue-router'
import { api } from '../api/http'
import { locale } from '../composables/useT'
import { MESSAGES } from '../i18n/messages'
import { FirebaseMessaging } from '../native/firebaseMessaging'
import { auth } from '../store/auth'
import { createPushRegistration, type PushState } from './pushRegistration'
import { routeForPush } from './pushRoute'

// Notifications de l'app parent (NAR-179), app native seulement (lancé par main.ts).
// - Jeton envoyé à l'ouverture d'une session si la permission est déjà accordée ; la
//   permission n'est demandée que par la carte « Notifications » de Mon compte, après son
//   explication (enablePush), jamais au premier lancement.
// - Toucher une notification ouvre l'écran prévu (routeForPush, liste fermée), une fois la
//   session restaurée : un toucher qui lance l'app est gardé jusque-là.
// - À chaque reprise de l'app : permission relue (changée dans les réglages du téléphone)
//   et jeton renvoyé s'il manque au serveur.
// - App au premier plan : bannière dans l'app (pushBanner), pas de notification système.
// - Canal Android « alertes » (celui du serveur, server/src/push.js), importance haute.
export const pushState = ref<PushState | 'off'>('off')
export const pushBanner = ref<{ title: string, body: string, to: RouteLocationRaw, at: number } | null>(null)

const registration = createPushRegistration({
  messaging: FirebaseMessaging,
  send: (r) => api.put('/push/token', r),
  platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
  lang: () => locale.value
})

export async function enablePush(): Promise<void> {
  pushState.value = await registration.enable()
}

let started = false
export function startParentPush(router: Router): void {
  if (started || !Capacitor.isNativePlatform()) return
  started = true
  // Canal recréé à chaque changement de langue : Android met alors son nom à jour.
  const channel = () => {
    if (Capacitor.getPlatform() !== 'android') return
    void FirebaseMessaging.createChannel({ id: 'alertes', name: MESSAGES[locale.value].push.channel, importance: 4, visibility: 0 }).catch(() => {})
  }
  channel()
  void FirebaseMessaging.addListener('tokenReceived', ({ token }) => { void registration.tokenChanged(token) }).catch(() => {})
  let pendingTap: RouteLocationRaw | null = null
  const openPending = () => {
    if (!pendingTap || !auth.ready || !auth.user) return
    const to = pendingTap
    pendingTap = null
    void router.push(to)
  }
  void FirebaseMessaging.addListener('notificationActionPerformed', ({ notification }) => {
    pushBanner.value = null
    pendingTap = routeForPush(notification.data)
    openPending()
  }).catch(() => {})
  void FirebaseMessaging.addListener('notificationReceived', ({ notification }) => {
    if (!auth.user || !notification.title) return
    pushBanner.value = { title: notification.title, body: notification.body ?? '', to: routeForPush(notification.data), at: Date.now() }
  }).catch(() => {})
  // Résultat d'un start() gardé seulement si la session est toujours la même.
  const refresh = async () => {
    const id = auth.user?.id
    if (!id) return
    const s = await registration.start()
    if (auth.user?.id === id) pushState.value = s
  }
  watch(() => [auth.ready, auth.user?.id] as const, ([ready, id], old) => {
    if (!ready) return
    if (!id) { registration.stop(); pushState.value = 'off'; pushBanner.value = null; pendingTap = null; return }
    if (old?.[1] && old[1] !== id) registration.stop() // autre compte : jeton renvoyé pour sa session
    openPending()
    void refresh()
  }, { immediate: true })
  void App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh() }).catch(() => {})
  watch(locale, () => { channel(); void registration.langChanged() })
}
