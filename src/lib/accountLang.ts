import { watch } from 'vue'
import { api } from '../api/http'
import { locale, localeChosen } from '../composables/useT'
import { auth } from '../store/auth'

// Langue des courriels (NAR-211) : le compte et l'app gardent la même langue.
// - À la connexion ou au rechargement, sans langue choisie sur cet appareil (seulement
//   devinée d'après le navigateur), l'app prend celle du compte : un nouvel appareil ne
//   change pas la langue des courriels.
// - Sinon, et à chaque changement de langue, la langue de l'app est envoyée au compte
//   (PUT /api/auth/me/lang). Les envois passent un par un et relisent la langue au moment
//   de partir : le dernier choix gagne même si l'on change vite.
// - Un échec (hors ligne) est retenté au retour du réseau, au prochain changement ou à la
//   prochaine ouverture.
let chain: Promise<void> = Promise.resolve()

function push(): void {
  chain = chain.then(async () => {
    const user = auth.user
    const lang = locale.value
    if (!user || user.lang === lang) return
    try {
      await api.put('/auth/me/lang', { lang })
      if (auth.user?.id === user.id) auth.user.lang = lang
    } catch { /* retenté plus tard */ }
  })
}

export function syncAccountLang(): void {
  watch(() => auth.user, (user) => {
    if (!user) return
    if (!localeChosen() && user.lang) locale.value = user.lang
    else push()
  }, { immediate: true })
  watch(locale, push)
  window.addEventListener('online', push)
}
