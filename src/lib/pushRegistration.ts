import type { FirebaseMessagingPlugin, PushPermission } from '../native/firebaseMessaging'

// Jeton push de l'app (NAR-179, ampy-push « Les jetons d'appareil ») : demandé au greffon,
// envoyé à la route de la session (parent : PUT /api/push/token ; enfant :
// PUT /api/device/push/token). Le serveur rattache le jeton à la session qui l'envoie :
// aucun identifiant de compte ni d'appareil ici. Renvoyé quand il change (rafraîchissement
// FCM) et quand la langue change (textes des notifications) ; un envoi refusé est retenté
// au prochain événement. Jamais de demande de permission ici : seulement après explication.
export type PushState = PushPermission | 'unavailable'
export interface Registration { token: string, platform: 'android' | 'ios', lang: string }

export function createPushRegistration({ messaging, send, platform, lang, needsPermission = true }: {
  messaging: Pick<FirebaseMessagingPlugin, 'checkPermissions' | 'requestPermissions' | 'getToken'>
  send(r: Registration): Promise<unknown>
  platform: 'android' | 'ios'
  lang(): string
  // App enfant : réveils silencieux seulement (data), aucune notification affichée : pas
  // de permission à demander.
  needsPermission?: boolean
}) {
  let token: string | null = null
  let sent = ''
  let active = false
  let chain: Promise<void> = Promise.resolve()

  // Envois un par un : un rafraîchissement et un changement de langue ne se croisent pas.
  function flush(): Promise<void> {
    chain = chain.then(async () => {
      if (!active || !token) return
      const r: Registration = { token, platform, lang: lang() }
      const key = `${r.token}|${r.lang}`
      if (key === sent) return
      try { await send(r); sent = key } catch { /* retenté au prochain événement */ }
    })
    return chain
  }

  async function register(): Promise<PushState> {
    try { token = (await messaging.getToken()).token } catch { return 'unavailable' }
    await flush()
    return 'granted'
  }

  async function state(): Promise<PushState> {
    try { return (await messaging.checkPermissions()).receive } catch { return 'unavailable' }
  }

  return {
    state,
    // Session ouverte : jeton envoyé si la permission est déjà accordée (ou inutile).
    async start(): Promise<PushState> {
      active = true
      const s = needsPermission ? await state() : 'granted'
      return s === 'granted' ? register() : s
    },
    // Après l'explication, sur un geste de la personne.
    async enable(): Promise<PushState> {
      let s: PushState
      try { s = (await messaging.requestPermissions()).receive } catch { return 'unavailable' }
      if (s !== 'granted') return s
      active = true
      return register()
    },
    tokenChanged(t: string): Promise<void> { token = t; return flush() },
    langChanged(): Promise<void> { return flush() },
    // Session fermée : le serveur efface les jetons de la session ; rien n'est plus envoyé.
    stop() { active = false; token = null; sent = '' }
  }
}
