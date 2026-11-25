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
// Coque sans le greffon (bundle OTA sur une coque antérieure) : UNIMPLEMENTED.
// Seul cas définitif ; toute autre erreur est passagère.
// Envoi refusé : retenté seulement si c'est passager (réseau, 429, 5xx) ; un autre refus
// (400 jeton ou langue, 401 session perdue) ne se règle pas en réessayant.
export function notConfigured(e: unknown): boolean {
  const err = e as { code?: unknown, message?: unknown } | null
  return err?.code === 'UNAVAILABLE' || err?.code === 'UNIMPLEMENTED' || /not (been )?configured|not initialized|not implemented/i.test(String(err?.message ?? ''))
}

export function retryable(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status
  return typeof status !== 'number' || status === 0 || status === 429 || status >= 500
}

export function createPushRegistration({ messaging, send, remove, platform, lang, needsPermission = true }: {
  messaging: Pick<FirebaseMessagingPlugin, 'checkPermissions' | 'requestPermissions' | 'getToken'>
  send(r: Registration): Promise<unknown>
  // Permission retirée dans les réglages du téléphone : jeton de cette session retiré du serveur.
  remove?(token: string): Promise<unknown>
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
  // Session : stop() change de génération ; un envoi commencé avant n'écrit plus rien.
  let generation = 0

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
      const gen = generation
      const r: Registration = { token, platform, lang: lang() }
      const key = `${r.token}|${r.lang}`
      if (key === sent) return
      try {
        await send(r)
        if (gen === generation) sent = key
      } catch (e) {
        if (gen === generation && retryable(e)) later()
      }
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
    // Envoi en arrière-plan : l'état (carte « Notifications ») n'attend pas le réseau.
    void flush()
    return 'granted'
  }

  // Permission absente ou retirée : plus rien n'est envoyé, nouvel essai annulé, et le jeton
  // déjà envoyé pour cette session est retiré du serveur (il ne recevrait plus rien).
  function deactivate() {
    active = false
    if (retry) { clearTimeout(retry); retry = null }
    if (sent && token && remove) void remove(token).catch(() => {})
    sent = ''
  }

  async function state(): Promise<PushState> {
    try { return (await messaging.checkPermissions()).receive } catch (e) { return notConfigured(e) ? 'unavailable' : 'prompt' }
  }

  return {
    state,
    // Session ouverte ou app reprise : jeton envoyé si la permission est déjà accordée
    // (ou inutile). Rappelée sans risque : rien n'est renvoyé si rien n'a changé.
    // Rien n'est envoyé (même un jeton rafraîchi par FCM) tant que la permission manque.
    async start(): Promise<PushState> {
      const gen = generation
      const s = needsPermission ? await state() : 'granted'
      if (gen !== generation) return s
      if (s !== 'granted') { deactivate(); return s }
      active = true
      return register()
    },
    // Après l'explication, sur un geste de la personne.
    async enable(): Promise<PushState> {
      const gen = generation
      let s: PushState
      try { s = (await messaging.requestPermissions()).receive } catch (e) { return notConfigured(e) ? 'unavailable' : 'prompt' }
      // Session fermée pendant la question du système : rien n'est enregistré.
      if (s !== 'granted' || gen !== generation) return s
      active = true
      return register()
    },
    tokenChanged(t: string): Promise<void> { token = t; return flush() },
    langChanged(): Promise<void> { return flush() },
    // Session fermée (ou nouvelle session d'appareil) : le serveur efface les jetons de
    // l'ancienne session ; tout est oublié, le prochain start() renvoie le jeton.
    stop() {
      generation++
      active = false
      token = null
      sent = ''
      if (retry) { clearTimeout(retry); retry = null }
    }
  }
}
