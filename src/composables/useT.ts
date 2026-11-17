import { computed, ref, watch, type ComputedRef } from 'vue'
import { MESSAGES, type Locale, type Messages } from '../i18n/messages'

const KEY = 'akaiky-v2.lang'
const LOCALES = Object.keys(MESSAGES) as Locale[]
const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as string[]).includes(v)

function initial(): Locale {
  // Le contenu de localStorage est une entrée non fiable : validé à la lecture.
  try {
    const saved = localStorage.getItem(KEY)
    if (isLocale(saved)) return saved
  } catch { /* stockage indisponible (navigation privée) */ }
  const browser = (navigator.languages ?? [navigator.language]).map((l) => l.slice(0, 2))
  return browser.find(isLocale) ?? 'mg'
}

// État global, déclaré au niveau du module : une seule langue pour toute l'app.
export const locale = ref<Locale>(initial())

watch(locale, (l) => {
  document.documentElement.lang = l
  try { localStorage.setItem(KEY, l) } catch { /* sans conséquence */ }
}, { immediate: true })

export const LOCALE_LIST = LOCALES

export function useT(): ComputedRef<Messages> {
  return computed(() => MESSAGES[locale.value])
}
