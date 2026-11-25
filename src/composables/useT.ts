import { computed, ref, watch, type ComputedRef } from 'vue'
import { MESSAGES, type Locale, type Messages } from '../i18n/messages'

const KEY = 'akaiky-v2.lang'
const LOCALES = Object.keys(MESSAGES) as Locale[]
const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as string[]).includes(v)

// Langue choisie par la personne (sélecteur, ou reprise de son compte) plutôt que
// devinée d'après le navigateur : seule une langue choisie est gardée, et seule elle
// l'emporte sur celle du compte à la connexion (NAR-211, src/lib/accountLang.ts).
let chosen = false

function initial(): Locale {
  // Le contenu de localStorage est une entrée non fiable : validé à la lecture.
  try {
    const saved = localStorage.getItem(KEY)
    if (isLocale(saved)) { chosen = true; return saved }
  } catch { /* stockage indisponible (navigation privée) */ }
  const browser = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2))
  return browser.find(isLocale) ?? 'mg'
}

// État global, déclaré au niveau du module : une seule langue pour toute l'app.
export const locale = ref<Locale>(initial())

export const localeChosen = (): boolean => chosen

watch(locale, (l) => { document.documentElement.lang = l }, { immediate: true })
// Tout changement après le démarrage est un choix : il est gardé.
watch(locale, (l) => {
  chosen = true
  try { localStorage.setItem(KEY, l) } catch { /* sans conséquence */ }
})

export const LOCALE_LIST = LOCALES

export function useT(): ComputedRef<Messages> {
  return computed(() => MESSAGES[locale.value])
}
