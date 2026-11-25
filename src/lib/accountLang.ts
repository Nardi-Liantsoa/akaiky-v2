import { watch } from 'vue'
import { api } from '../api/http'
import { locale } from '../composables/useT'
import { auth } from '../store/auth'

// Langue des courriels (NAR-211) : le compte suit la langue de l'app. À la connexion, au
// rechargement et à chaque changement de langue, si le serveur en garde une autre, elle est
// envoyée (PUT /api/auth/me/lang). Un échec (hors ligne) est sans conséquence : nouvel
// essai au prochain changement ou à la prochaine ouverture. Lancé une fois par main.ts.
export function syncAccountLang(): void {
  watch([() => auth.user, locale], async ([user, lang]) => {
    if (!user || user.lang === lang) return
    try {
      await api.put('/auth/me/lang', { lang })
      if (auth.user?.id === user.id && locale.value === lang) auth.user.lang = lang
    } catch { /* gardée pour la prochaine fois */ }
  }, { immediate: true })
}
