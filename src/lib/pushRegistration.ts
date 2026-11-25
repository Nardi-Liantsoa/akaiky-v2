import type { FirebaseMessagingPlugin, PushPermission } from '../native/firebaseMessaging'

// Jeton push de l'app (NAR-179, ampy-push « Les jetons d'appareil ») : demandé au greffon,
// envoyé à la route de la session (parent : PUT /api/push/token ; enfant :
// PUT /api/device/push/token). Le serveur rattache le jeton à la session qui l'envoie :
// aucun identifiant de compte ni d'appareil ici. Renvoyé quand il change (rafraîchissement
// FCM) et quand la langue change (textes des notifications). Un jeton non obtenu (réseau,
// APNs pas encore prêt) ou un envoi refusé (hors ligne, 5xx, 429) est retenté toutes les
// 30 s tant que la session est ouverte, et à chaque reprise de l'app (start).
// Jamais de demande de permission ici sans geste : seulement par enable(), après explication.
export type PushState = PushPermission | 'unavailable'
export interface Registration { token: string, platform: 'android' | 'ios', lang: string }

export const RETRY_MS = 30_000

// Firebase absent de la coque (pas de google-services.json / GoogleService-Info.plist) :
// iOS rejette en UNAVAILABLE, Android avec « Default FirebaseApp is not initialized ».
// Seul cas définitif ; toute autre erreur est passagère.
export function notConfigured(e: unknown): boolean {
  const err = e as { code?: unknown, message?: unknown } | null
  return err?.code === 'UNAVAILABLE' || /not (been )?configured|not initialized/i.test(String(err?.message ?? ''))
}

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
  let retry: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<void> = Promise.resolve()

  function later() {
    if (!active || retry) return
    retry = setTimeout(() => {
      retry = null
      if (!active) return
      if (token) void flush(); else void register()
    }, RETRY_MS)
  }

  // Envois un par un : un rafraîchissement et un changement de langue ne se croisent pas.
  function flush(): Promise<void> {
    chain = chain.then(async () => {
      if (!active || !token) return
      const r: Registration = { token, platform, lang: lang() }
      const key = `${r.token}|${r.lang}`
      if (key === sent) return
      try { await send(r); sent = key } catch { later() }
    })
    return chain
  }

  async function register(): Promise<PushState> {
    try {
      token = (await messaging.getToken()).token
    } catch (e) {
      if (notConfigured(e)) return 'unavailable'
      later()
      return 'granted'
    }
    await flush()
    return 'granted'
  }

  async function state(): Promise<PushState> {
    try { return (await messaging.checkPermissions()).receive } catch (e) { return notConfigured(e) ? 'unavailable' : 'prompt' }
  }

  return {
    state,
    // Session ouverte ou app reprise : jeton envoyé si la permission est déjà accordée
    // (ou inutile). Rappelée sans risque : rien n'est renvoyé si rien n'a changé.
    async start(): Promise<PushState> {
      active = true
      const s = needsPermission ? await state() : 'granted'
      return s === 'granted' ? register() : s
    },
    // Après l'explication, sur un geste de la personne.
    async enable(): Promise<PushState> {
      let s: PushState
      try { s = (await messaging.requestPermissions()).receive } catch (e) { return notConfigured(e) ? 'unavailable' : 'prompt' }
      if (s !== 'granted') return s
      active = true
      return register()
    },
    tokenChanged(t: string): Promise<void> { token = t; return flush() },
    langChanged(): Promise<void> { return flush() },
    // Session fermée (ou nouvelle session d'appareil) : le serveur efface les jetons de
    // l'ancienne session ; tout est oublié, le prochain start() renvoie le jeton.
    stop() {
      active = false
      token = null
      sent = ''
      if (retry) { clearTimeout(retry); retry = null }
    }
  }
}
