import { watch } from 'vue'
import { api } from '../api/http'
import { adoptLocale, locale, localeChosen } from '../composables/useT'
import { auth } from '../store/auth'

// Langue des courriels (NAR-211) : le compte et l'app gardent la même langue.
// - À la connexion ou au rechargement, sans langue choisie sur cet appareil (seulement
//   devinée d'après le navigateur, ou reprise d'un compte), l'app prend celle du compte,
//   sans la garder comme un choix : un nouvel appareil, ou un appareil partagé, ne change
//   pas la langue des courriels d'un compte.
// - Sinon, et à chaque changement de langue fait par la personne, la langue de l'app est
//   envoyée au compte (PUT /api/auth/me/lang). Les envois passent un par un et relisent
//   la langue au moment de partir : le dernier choix gagne même si l'on change vite.
// - Un échec (hors ligne, 429, 5xx) est retenté après 30 s, et au retour du réseau.
const RETRY_MS = 30_000
let chain: Promise<void> = Promise.resolve()
let retry: ReturnType<typeof setTimeout> | null = null
let started = false

function push(): void {
  chain = chain.then(async () => {
    const user = auth.user
    const lang = locale.value
    if (!user || user.lang === lang) return
    try {
      await api.put('/auth/me/lang', { lang })
      if (auth.user?.id === user.id) auth.user.lang = lang
    } catch {
      retry ??= setTimeout(() => { retry = null; push() }, RETRY_MS)
    }
  })
}

// Appelé une fois par main.ts, dans l'app parent seulement (l'app enfant n'a pas de compte).
export function syncAccountLang(): void {
  if (started) return
  started = true
  watch(() => auth.user, (user) => {
    if (!user) return
    if (!localeChosen() && user.lang) adoptLocale(user.lang)
    else push()
  }, { immediate: true })
  watch(locale, push)
  window.addEventListener('online', push)
}
