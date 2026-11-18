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

// Dernier résultat lu, pour l'affichage (en-tête) : null tant qu'il n'est pas connu.
// Mis à jour à chaque lecture, y compris au nouvel essai après un échec.
export const currentKind = ref<AppKind | null>(null)

let pending: Promise<AppKind> | null = null
export function appKind(): Promise<AppKind> {
  // Lecture native en échec (appel local, ne devrait pas arriver) : enfant, sans le
  // retenir, pour réessayer à la navigation suivante. On échoue fermé : le
  // téléphone de l'enfant ne doit jamais montrer l'espace parent, alors que l'écran
  // enfant ne montre rien (un parent relance l'app).
  // Identifiant vide : même échec fermé.
  const failClosed = (): AppKind => { pending = null; return 'enfant' }
  pending ??= Capacitor.isNativePlatform()
    ? App.getInfo().then((info) => (info.id ? kindFromAppId(info.id) : failClosed()), failClosed)
    : Promise.resolve('parent')
  return pending.then((kind) => { currentKind.value = kind; return kind })
}
