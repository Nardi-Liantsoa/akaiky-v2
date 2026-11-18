import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

// Dans quelle application tourne ce code : l'app parent (Play Store, App Store,
// web) ou l'app enfant (variante Android « enfant », installée par QR). Lu une
// fois, depuis l'identifiant natif de l'application ; le web est toujours parent.
export type AppKind = 'parent' | 'enfant'
export const CHILD_APP_ID = 'mg.nosytech.akaiky.enfant'

// Préfixe, pas égalité : une variante dérivée de l'app enfant (suffixe .debug, .staging)
// reste l'app enfant. L'identifiant parent n'en est pas un préfixe.
export const kindFromAppId = (id: string | null | undefined): AppKind =>
  id === CHILD_APP_ID || id?.startsWith(`${CHILD_APP_ID}.`) ? 'enfant' : 'parent'

// Résultat pour l'affichage (en-tête) : null tant qu'il n'est pas connu.
export const currentKind = ref<AppKind | null>(null)

// Lu une seule fois par lancement, et retenu même en cas d'échec : routeur, en-tête
// et bouton retour voient toujours la même réponse. Lecture native en échec ou
// identifiant vide (appel local, ne devrait pas arriver) : enfant. On échoue fermé :
// le téléphone de l'enfant ne doit jamais montrer l'espace parent ; l'écran enfant,
// lui, ne montre rien (un parent qui le verrait force l'arrêt de l'app).
let pending: Promise<AppKind> | null = null
export function appKind(): Promise<AppKind> {
  pending ??= (Capacitor.isNativePlatform()
    ? App.getInfo().then((info): AppKind => (info.id ? kindFromAppId(info.id) : 'enfant'), (): AppKind => 'enfant')
    : Promise.resolve<AppKind>('parent')
  ).then((kind) => { currentKind.value = kind; return kind })
  return pending
}
